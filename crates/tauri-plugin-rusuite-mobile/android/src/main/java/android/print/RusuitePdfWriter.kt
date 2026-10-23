// The webview's PDF renderer driven by hand (P10-M6): `WebView.createPrintDocumentAdapter()` laid out on the
// page's paper and written into a file, without the print dialog. It lives in `android.print` because the
// constructors of `LayoutResultCallback` / `WriteResultCallback` are package-private in the SDK stubs (public
// but @hide in the framework) – the usual way to call the adapter outside the print spooler.

package android.print

import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import java.io.File

object RusuitePdfWriter {
  /**
   * Lays out `adapter` with `attributes` and writes all pages to `file`; `done` gets `null` on success or the
   * error message. Call on the main thread (the adapter's callbacks arrive there too).
   */
  fun write(adapter: PrintDocumentAdapter, attributes: PrintAttributes, file: File, done: (String?) -> Unit) {
    val cancel = CancellationSignal()
    var finished = false
    fun finish(error: String?) {
      if (finished) return
      finished = true
      try {
        adapter.onFinish()
      } catch (_: Exception) {
      }
      done(error)
    }
    try {
      adapter.onStart()
      adapter.onLayout(null, attributes, cancel, object : PrintDocumentAdapter.LayoutResultCallback() {
        override fun onLayoutFinished(info: PrintDocumentInfo, changed: Boolean) {
          val fd = try {
            file.parentFile?.mkdirs()
            ParcelFileDescriptor.open(
              file,
              ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_CREATE or
                ParcelFileDescriptor.MODE_TRUNCATE
            )
          } catch (e: Exception) {
            finish(e.message ?: "cannot create the PDF file")
            return
          }
          adapter.onWrite(arrayOf(PageRange.ALL_PAGES), fd, cancel, object : PrintDocumentAdapter.WriteResultCallback() {
            override fun onWriteFinished(pages: Array<out PageRange>) {
              fd.close()
              finish(if (file.length() > 0) null else "the PDF is empty")
            }

            override fun onWriteFailed(error: CharSequence?) {
              fd.close()
              finish(error?.toString() ?: "writing the PDF failed")
            }

            override fun onWriteCancelled() {
              fd.close()
              finish("writing the PDF was cancelled")
            }
          })
        }

        override fun onLayoutFailed(error: CharSequence?) {
          finish(error?.toString() ?: "the PDF layout failed")
        }

        override fun onLayoutCancelled() {
          finish("the PDF layout was cancelled")
        }
      }, Bundle())
    } catch (e: Exception) {
      finish(e.message ?: e.javaClass.simpleName)
    }
  }
}
