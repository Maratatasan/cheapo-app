package expo.modules.cheapophototext

import android.graphics.Rect
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CheapoPhotoTextModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CheapoPhotoText")
    AsyncFunction("read") { source: String, promise: Promise ->
      readLocalImage(source, promise)
    }
  }

  private fun readLocalImage(source: String, promise: Promise) {
    try {
      val uri = Uri.parse(source)
      require((uri.scheme == "file" && uri.authority.isNullOrEmpty()) ||
        (uri.scheme == "content" && !uri.authority.isNullOrEmpty()))
      val context = checkNotNull(appContext.reactContext)
      val image = InputImage.fromFilePath(context, uri)
      val sideways = image.rotationDegrees % 180 != 0
      val width = if (sideways) image.height else image.width
      val height = if (sideways) image.width else image.height
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try {
        recognizer.process(image).addOnCompleteListener { task ->
          try {
            if (task.isSuccessful) promise.resolve(evidence(task.result, width, height))
            else rejectPhoto(promise)
          } catch (_: Exception) {
            rejectPhoto(promise)
          } finally {
            recognizer.close()
          }
        }
      } catch (error: Exception) {
        recognizer.close()
        throw error
      }
    } catch (_: Exception) {
      rejectPhoto(promise)
    }
  }

  private fun rejectPhoto(promise: Promise) {
    promise.reject("ERR_PHOTO_TEXT", "Could not read text from this photo.", null)
  }

  private fun evidence(text: Text, width: Int, height: Int): Map<String, Any> {
    val blocks = text.textBlocks.map { block ->
      mapOf("lines" to block.lines.map { line ->
        textWithBox(line.text, line.boundingBox, width, height) + ("elements" to line.elements.map { element ->
          textWithBox(element.text, element.boundingBox, width, height)
        })
      })
    }
    return mapOf("width" to width, "height" to height, "blocks" to blocks)
  }

  private fun textWithBox(text: String, box: Rect?, width: Int, height: Int): Map<String, Any> {
    val result = mutableMapOf<String, Any>("text" to text)
    if (box != null) {
      val left = box.left.coerceIn(0, width)
      val top = box.top.coerceIn(0, height)
      val right = box.right.coerceIn(0, width)
      val bottom = box.bottom.coerceIn(0, height)
      if (left < right && top < bottom) {
        result["box"] = listOf(left.toDouble() / width, top.toDouble() / height,
          right.toDouble() / width, bottom.toDouble() / height)
      }
    }
    return result
  }
}
