// Rusuite's mobile document access on Android (P10-M1): Storage Access Framework pickers, write-back to the picked
// document, export through ACTION_CREATE_DOCUMENT, the share sheet and "Open with" intents; PDF export (P10-M6)
// through the webview's own print adapter (android/print/RusuitePdfWriter.kt). The Rust half is
// `crates/tauri-plugin-rusuite-mobile/src/lib.rs`; every reply is `{ document?: … }` (missing = cancelled).

package dev.rusuite.mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.print.RusuitePdfWriter
import android.content.Context
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

@InvokeArg
class PickArgs {
  var mimeTypes: Array<String> = arrayOf()
}

@InvokeArg
class HandleArgs {
  lateinit var handle: String
}

@InvokeArg
class WriteArgs {
  lateinit var handle: String
  lateinit var bytesBase64: String
}

@InvokeArg
class ExportArgs {
  lateinit var name: String
  var mimeType: String = "application/octet-stream"
  lateinit var bytesBase64: String
}

@InvokeArg
class PaperArgs {
  var widthMm: Double = 210.0
  var heightMm: Double = 297.0
  var landscape: Boolean = false
}

@InvokeArg
class PdfArgs {
  lateinit var name: String
  var paper: PaperArgs = PaperArgs()
}

/** Hands a finished PDF file to the print service (the system dialog re-reads it for every preview). */
class PdfFileAdapter(private val name: String, private val file: File) : PrintDocumentAdapter() {
  override fun onLayout(
    oldAttributes: PrintAttributes?,
    newAttributes: PrintAttributes,
    cancellationSignal: CancellationSignal?,
    callback: LayoutResultCallback,
    extras: Bundle?
  ) {
    if (cancellationSignal?.isCanceled == true) {
      callback.onLayoutCancelled()
      return
    }
    val info = PrintDocumentInfo.Builder(name)
      .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
      .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
      .build()
    callback.onLayoutFinished(info, oldAttributes == null)
  }

  override fun onWrite(
    pages: Array<out PageRange>?,
    destination: ParcelFileDescriptor,
    cancellationSignal: CancellationSignal?,
    callback: WriteResultCallback
  ) {
    try {
      FileInputStream(file).use { input ->
        FileOutputStream(destination.fileDescriptor).use { output -> input.copyTo(output) }
      }
      callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
    } catch (e: Exception) {
      callback.onWriteFailed(e.message)
    }
  }
}

@TauriPlugin
class RusuiteMobilePlugin(private val activity: Activity) : Plugin(activity) {
  /** The document of the last VIEW/EDIT intent, until the page takes it. */
  private var launchUri: Uri? = null
  /** The bytes of the export in progress (ACTION_CREATE_DOCUMENT returns before they are written). */
  private var exportBytes: ByteArray? = null

  /** The app's webview (its print media is the page's print root while a PDF is made). */
  private var webView: WebView? = null
  /** The rendered PDF of the export in progress (ACTION_CREATE_DOCUMENT returns before it is copied). */
  private var exportPdfFile: File? = null

  override fun load(webView: WebView) {
    this.webView = webView
    remember(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    remember(intent)
  }

  private fun remember(intent: Intent?) {
    if (intent == null) return
    if (intent.action != Intent.ACTION_VIEW && intent.action != Intent.ACTION_EDIT) return
    val uri = intent.data ?: return
    launchUri = uri
    // Taken once: a recreated activity must not open it again.
    intent.action = Intent.ACTION_MAIN
  }

  /** Runs `work` off the main thread and resolves with its result (rejects with the exception's message). */
  private fun io(invoke: Invoke, work: () -> JSObject) {
    Thread {
      try {
        invoke.resolve(work())
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.javaClass.simpleName)
      }
    }.start()
  }

  private fun displayName(uri: Uri): String {
    try {
      activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (i >= 0) c.getString(i)?.let { return it }
        }
      }
    } catch (_: Exception) {
      // Fall through: some providers refuse queries.
    }
    return uri.lastPathSegment?.substringAfterLast('/') ?: "document"
  }

  private fun read(uri: Uri): JSObject {
    val bytes = activity.contentResolver.openInputStream(uri)?.use { it.readBytes() }
      ?: throw IllegalStateException("cannot read $uri")
    val doc = JSObject()
    doc.put("handle", uri.toString())
    doc.put("name", displayName(uri))
    doc.put("bytesBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
    return doc
  }

  private fun write(uri: Uri, bytes: ByteArray) {
    // "wt" truncates; a few providers only know "w".
    val out = try {
      activity.contentResolver.openOutputStream(uri, "wt")
    } catch (_: IllegalArgumentException) {
      activity.contentResolver.openOutputStream(uri, "w")
    } ?: throw IllegalStateException("cannot write $uri")
    out.use { it.write(bytes) }
  }

  /** Keeps access across restarts (recent files); providers without persistable grants still work this session. */
  private fun persist(uri: Uri) {
    val rw = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    try {
      activity.contentResolver.takePersistableUriPermission(uri, rw)
    } catch (_: SecurityException) {
      try {
        activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } catch (_: SecurityException) {
      }
    }
  }

  private fun wrap(doc: JSObject?): JSObject {
    val ret = JSObject()
    if (doc != null) ret.put("document", doc)
    return ret
  }

  private fun grants(intent: Intent) {
    intent.addFlags(
      Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
    )
  }

  @Command
  fun pickDocument(invoke: Invoke) {
    val args = invoke.parseArgs(PickArgs::class.java)
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.type = "*/*"
    if (args.mimeTypes.isNotEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, args.mimeTypes)
    grants(intent)
    startActivityForResult(invoke, intent, "pickResult")
  }

  @ActivityCallback
  fun pickResult(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(wrap(null))
      return
    }
    persist(uri)
    io(invoke) { wrap(read(uri)) }
  }

  @Command
  fun readDocument(invoke: Invoke) {
    val args = invoke.parseArgs(HandleArgs::class.java)
    io(invoke) { wrap(read(Uri.parse(args.handle))) }
  }

  @Command
  fun writeDocument(invoke: Invoke) {
    val args = invoke.parseArgs(WriteArgs::class.java)
    io(invoke) {
      val uri = Uri.parse(args.handle)
      write(uri, Base64.decode(args.bytesBase64, Base64.DEFAULT))
      val ret = JSObject()
      ret.put("name", displayName(uri))
      ret
    }
  }

  @Command
  fun exportDocument(invoke: Invoke) {
    val args = invoke.parseArgs(ExportArgs::class.java)
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.type = args.mimeType
    intent.putExtra(Intent.EXTRA_TITLE, args.name)
    grants(intent)
    exportBytes = Base64.decode(args.bytesBase64, Base64.DEFAULT)
    try {
      startActivityForResult(invoke, intent, "exportResult")
    } catch (_: ActivityNotFoundException) {
      // No document provider (some managed or TV devices): hand the file to the share sheet instead.
      exportBytes = null
      share(invoke, args)
    }
  }

  @ActivityCallback
  fun exportResult(invoke: Invoke, result: ActivityResult) {
    val bytes = exportBytes
    exportBytes = null
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null || bytes == null) {
      invoke.resolve(wrap(null))
      return
    }
    persist(uri)
    io(invoke) {
      write(uri, bytes)
      val doc = JSObject()
      doc.put("handle", uri.toString())
      doc.put("name", displayName(uri))
      wrap(doc)
    }
  }

  @Command
  fun shareDocument(invoke: Invoke) {
    share(invoke, invoke.parseArgs(ExportArgs::class.java))
  }

  /** ACTION_SEND of a cache copy (`res/xml/file_paths.xml` exposes `cache/share/` only). */
  private fun share(invoke: Invoke, args: ExportArgs) {
    io(invoke) {
      val dir = File(activity.cacheDir, "share")
      dir.mkdirs()
      val file = File(dir, args.name.replace('/', '_').ifEmpty { "document" })
      file.writeBytes(Base64.decode(args.bytesBase64, Base64.DEFAULT))
      val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
      val send = Intent(Intent.ACTION_SEND)
      send.type = args.mimeType
      send.putExtra(Intent.EXTRA_STREAM, uri)
      send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, args.name)) }
      JSObject()
    }
  }

  @Command
  fun takeLaunchDocument(invoke: Invoke) {
    val uri = launchUri
    launchUri = null
    if (uri == null) {
      invoke.resolve(wrap(null))
      return
    }
    io(invoke) { wrap(read(uri)) }
  }
  // ------------------------------------------------------------------ PDF (P10-M6)

  /** The page's paper as print attributes: a custom media size in mils, no margins (the pages carry theirs). */
  private fun attributes(paper: PaperArgs): PrintAttributes {
    val mils = { mm: Double -> Math.round(mm / 25.4 * 1000.0).toInt().coerceIn(100, 200_000) }
    val short = mils(minOf(paper.widthMm, paper.heightMm))
    val long = mils(maxOf(paper.widthMm, paper.heightMm))
    var media = PrintAttributes.MediaSize("rusuite_${short}x$long", "Rusuite", short, long)
    if (paper.landscape || paper.widthMm > paper.heightMm) media = media.asLandscape()
    return PrintAttributes.Builder()
      .setMediaSize(media)
      .setResolution(PrintAttributes.Resolution("rusuite", "PDF", 600, 600))
      .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
      .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
      .build()
  }

  private fun pdfName(name: String): String {
    val safe = name.replace('/', '_').ifEmpty { "document.pdf" }
    return if (safe.lowercase().endsWith(".pdf")) safe else "$safe.pdf"
  }

  /** Renders the webview to `file` on the main thread; `done(null)` on success, else with the error message. */
  private fun render(args: PdfArgs, file: File, done: (String?) -> Unit) {
    activity.runOnUiThread {
      val view = webView
      if (view == null) {
        done("the webview is not ready")
        return@runOnUiThread
      }
      val adapter = view.createPrintDocumentAdapter(pdfName(args.name))
      RusuitePdfWriter.write(adapter, attributes(args.paper), file, done)
    }
  }

  private fun pdfFile(): File = File(File(activity.cacheDir, "pdf"), "render.pdf")

  @Command
  fun exportPdf(invoke: Invoke) {
    val args = invoke.parseArgs(PdfArgs::class.java)
    val file = pdfFile()
    render(args, file) { error ->
      if (error != null) {
        invoke.reject(error)
        return@render
      }
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.type = "application/pdf"
      intent.putExtra(Intent.EXTRA_TITLE, pdfName(args.name))
      exportPdfFile = file
      try {
        startActivityForResult(invoke, intent, "exportPdfResult")
      } catch (_: ActivityNotFoundException) {
        // No document provider: the share sheet instead (as exportDocument).
        exportPdfFile = null
        sharePdfFile(invoke, file, pdfName(args.name))
      }
    }
  }

  @ActivityCallback
  fun exportPdfResult(invoke: Invoke, result: ActivityResult) {
    val file = exportPdfFile
    exportPdfFile = null
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null || file == null) {
      file?.delete()
      invoke.resolve(wrap(null))
      return
    }
    io(invoke) {
      try {
        write(uri, file.readBytes())
      } finally {
        file.delete()
      }
      // No handle: the apps cannot open a PDF, so it never enters the recent list.
      val doc = JSObject()
      doc.put("name", displayName(uri))
      wrap(doc)
    }
  }

  @Command
  fun sharePdf(invoke: Invoke) {
    val args = invoke.parseArgs(PdfArgs::class.java)
    val file = pdfFile()
    render(args, file) { error ->
      if (error != null) invoke.reject(error) else sharePdfFile(invoke, file, pdfName(args.name))
    }
  }

  /** ACTION_SEND of the rendered PDF, moved into `cache/share/` (the FileProvider's only path). */
  private fun sharePdfFile(invoke: Invoke, file: File, name: String) {
    io(invoke) {
      val dir = File(activity.cacheDir, "share")
      dir.mkdirs()
      val shared = File(dir, name)
      file.copyTo(shared, overwrite = true)
      file.delete()
      val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", shared)
      val send = Intent(Intent.ACTION_SEND)
      send.type = "application/pdf"
      send.putExtra(Intent.EXTRA_STREAM, uri)
      send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, name)) }
      JSObject()
    }
  }

  @Command
  fun printPdf(invoke: Invoke) {
    val args = invoke.parseArgs(PdfArgs::class.java)
    // One file per job: the print service reads it while its dialog is open, after this call returned.
    val file = File(File(activity.cacheDir, "pdf"), "print-${System.currentTimeMillis()}.pdf")
    File(activity.cacheDir, "pdf").listFiles()?.filter { it.name.startsWith("print-") }?.forEach { it.delete() }
    render(args, file) { error ->
      if (error != null) {
        invoke.reject(error)
        return@render
      }
      try {
        val manager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
        val name = pdfName(args.name)
        manager.print(name, PdfFileAdapter(name, file), attributes(args.paper))
        invoke.resolve(JSObject())
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.javaClass.simpleName)
      }
    }
  }
}
