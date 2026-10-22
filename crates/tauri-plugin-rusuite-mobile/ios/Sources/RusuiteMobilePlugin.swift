// Rusuite's mobile document access on iOS (P10-M1): the document picker opening in place, coordinated write-back
// through a bookmark, export with UIDocumentPickerViewController(forExporting:), the share sheet and reading the
// documents the app is opened with. The Rust half is `crates/tauri-plugin-rusuite-mobile/src/lib.rs`; every reply
// is `{ document?: … }` (missing = cancelled).

import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

struct PickArgs: Decodable {
  let utis: [String]?
}

struct HandleArgs: Decodable {
  let handle: String
}

struct WriteArgs: Decodable {
  let handle: String
  let bytesBase64: String
}

struct ExportArgs: Decodable {
  let name: String
  let uti: String?
  let bytesBase64: String
}

struct Doc: Encodable {
  let handle: String
  let name: String
  let bytesBase64: String
}

struct Exported: Encodable {
  let handle: String?
  let name: String
}

struct DocReply<T: Encodable>: Encodable {
  let document: T?
}

struct Written: Encodable {
  let name: String
}

enum RusuiteError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    switch self {
    case .message(let m): return m
    }
  }
}

/// One picker at a time: the delegate forwards the picked URLs (nil = cancelled).
class PickerDelegate: NSObject, UIDocumentPickerDelegate {
  var done: (([URL]?) -> Void)?

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let f = done
    done = nil
    f?(urls)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let f = done
    done = nil
    f?(nil)
  }
}

class RusuiteMobilePlugin: Plugin {
  private let delegate = PickerDelegate()

  private func present(_ vc: UIViewController) {
    guard let root = self.manager.viewController else { return }
    if let pop = vc.popoverPresentationController {
      // iPad: anchor popovers (the share sheet) in the middle of the window.
      pop.sourceView = root.view
      pop.sourceRect = CGRect(x: root.view.bounds.midX, y: root.view.bounds.midY, width: 0, height: 0)
      pop.permittedArrowDirections = []
    }
    root.present(vc, animated: true, completion: nil)
  }

  /// `bm:<base64 bookmark>` (survives restarts and moves), else the URL itself.
  private func handle(for url: URL) -> String {
    if let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
      return "bm:" + data.base64EncodedString()
    }
    return url.absoluteString
  }

  private func url(for handle: String) throws -> URL {
    if handle.hasPrefix("bm:") {
      guard let data = Data(base64Encoded: String(handle.dropFirst(3))) else {
        throw RusuiteError.message("invalid document handle")
      }
      var stale = false
      return try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
    }
    guard let url = URL(string: handle) else { throw RusuiteError.message("invalid document handle") }
    return url
  }

  /// Runs `body` with the security scope of `url` and a file coordinator (`writing` = replacing the contents).
  private func coordinated<T>(_ url: URL, writing: Bool, _ body: (URL) throws -> T) throws -> T {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    var coordError: NSError?
    var result: Result<T, Error> = .failure(RusuiteError.message("file coordination failed"))
    let coordinator = NSFileCoordinator()
    if writing {
      coordinator.coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { u in
        result = Result { try body(u) }
      }
    } else {
      coordinator.coordinate(readingItemAt: url, options: [], error: &coordError) { u in
        result = Result { try body(u) }
      }
    }
    if let e = coordError { throw e }
    return try result.get()
  }

  private func read(_ url: URL) throws -> Doc {
    let data = try coordinated(url, writing: false) { try Data(contentsOf: $0) }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    return Doc(handle: handle(for: url), name: url.lastPathComponent, bytesBase64: data.base64EncodedString())
  }

  private func background(_ invoke: Invoke, _ work: @escaping () throws -> Void) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        try work()
      } catch {
        invoke.reject(error.localizedDescription)
      }
    }
  }

  /// A temporary copy named `name` (the export and share sources).
  private func temporaryCopy(_ name: String, _ base64: String) throws -> URL {
    guard let data = Data(base64Encoded: base64) else { throw RusuiteError.message("invalid base64") }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("rusuite-export", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let safe = name.replacingOccurrences(of: "/", with: "_")
    let file = dir.appendingPathComponent(safe.isEmpty ? "document" : safe)
    try data.write(to: file, options: .atomic)
    return file
  }

  @objc public func pickDocument(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PickArgs.self)
    let types = (args.utis ?? []).compactMap { UTType($0) }
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: types.isEmpty ? [UTType.data] : types, asCopy: false)
      picker.delegate = self.delegate
      picker.allowsMultipleSelection = false
      self.delegate.done = { urls in
        guard let url = urls?.first else {
          invoke.resolve(DocReply<Doc>(document: nil))
          return
        }
        self.background(invoke) { invoke.resolve(DocReply(document: try self.read(url))) }
      }
      self.present(picker)
    }
  }

  @objc public func readDocument(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(HandleArgs.self)
    background(invoke) { invoke.resolve(DocReply(document: try self.read(try self.url(for: args.handle)))) }
  }

  @objc public func writeDocument(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WriteArgs.self)
    background(invoke) {
      guard let data = Data(base64Encoded: args.bytesBase64) else { throw RusuiteError.message("invalid base64") }
      let url = try self.url(for: args.handle)
      try self.coordinated(url, writing: true) { try data.write(to: $0) }
      invoke.resolve(Written(name: url.lastPathComponent))
    }
  }

  @objc public func exportDocument(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ExportArgs.self)
    let source = try temporaryCopy(args.name, args.bytesBase64)
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forExporting: [source], asCopy: true)
      picker.delegate = self.delegate
      self.delegate.done = { urls in
        try? FileManager.default.removeItem(at: source)
        guard let dest = urls?.first else {
          invoke.resolve(DocReply<Exported>(document: nil))
          return
        }
        // A bookmark lets the next Save write there again; without one the document stays untitled.
        let scoped = dest.startAccessingSecurityScopedResource()
        defer { if scoped { dest.stopAccessingSecurityScopedResource() } }
        let bookmark = try? dest.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        invoke.resolve(
          DocReply(
            document: Exported(
              handle: bookmark.map { "bm:" + $0.base64EncodedString() }, name: dest.lastPathComponent)))
      }
      self.present(picker)
    }
  }

  @objc public func shareDocument(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ExportArgs.self)
    let file = try temporaryCopy(args.name, args.bytesBase64)
    DispatchQueue.main.async {
      let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
      sheet.completionWithItemsHandler = { _, _, _, _ in
        try? FileManager.default.removeItem(at: file)
        invoke.resolve()
      }
      self.present(sheet)
    }
  }

  /// Android only (iOS launch documents arrive as `RunEvent::Opened` in Rust and are read with `readDocument`).
  @objc public func takeLaunchDocument(_ invoke: Invoke) throws {
    invoke.resolve(DocReply<Doc>(document: nil))
  }
}

@_cdecl("init_plugin_rusuite_mobile")
func initPlugin() -> Plugin {
  return RusuiteMobilePlugin()
}
