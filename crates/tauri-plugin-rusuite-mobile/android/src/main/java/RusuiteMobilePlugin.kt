// Rusuite's mobile document access on Android (P10-M1): Storage Access Framework pickers, write-back to the picked
// document, export through ACTION_CREATE_DOCUMENT, the share sheet and "Open with" intents. The Rust half is
// `crates/tauri-plugin-rusuite-mobile/src/lib.rs`; every reply is `{ document?: … }` (missing = cancelled).

package dev.rusuite.mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
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

@TauriPlugin
class RusuiteMobilePlugin(private val activity: Activity) : Plugin(activity) {
  /** The document of the last VIEW/EDIT intent, until the page takes it. */
  private var launchUri: Uri? = null
  /** The bytes of the export in progress (ACTION_CREATE_DOCUMENT returns before they are written). */
  private var exportBytes: ByteArray? = null

  override fun load(webView: WebView) {
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
}
