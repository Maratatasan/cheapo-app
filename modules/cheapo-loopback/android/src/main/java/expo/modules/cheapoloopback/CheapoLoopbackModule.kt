package expo.modules.cheapoloopback
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.net.URI
import javax.net.ssl.HttpsURLConnection
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.net.Socket
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.RSAPublicKey

class CheapoLoopbackModule : Module() {
  private var receiver: LoopbackReceiver? = null
  override fun definition() = ModuleDefinition {
    Name("CheapoLoopback")
    AsyncFunction("startReceiver") { state: String ->
      receiver?.close()
      val active = LoopbackReceiver(state)
      receiver = active
      mapOf("port" to active.port())
    }
    AsyncFunction("waitForCallback") { promise: Promise ->
      val active = receiver
      if (active == null) promise.reject("ERR_CALLBACK", "Start phone sign-in again.", null)
      else Thread {
        try { promise.resolve(active.await(600000)) }
        catch (error: Exception) { promise.reject("ERR_CALLBACK", "Phone sign-in timed out or was cancelled.", null) }
      }.start()
    }
    AsyncFunction("stopReceiver") { receiver?.close(); receiver = null }
    Function("decodeBase64Url") { value: String ->
      require(value.length <= 65536) { "Identity field too large" }
      String(Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8)
    }
    Function("verifyRs256") { input: String, signature: String, modulus: String, exponent: String ->
      try {
        val flags = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        RsaVerifier.verify(input, Base64.decode(signature, flags), Base64.decode(modulus, flags), Base64.decode(exponent, flags))
      } catch (error: Exception) { false }
    }
    AsyncFunction("requestJson") { address: String, form: String? ->
      try {
      val uri = URI(address)
      require(uri.scheme == "https" && uri.host == "auth.openai.com" && (uri.port == -1 || uri.port == 443) && uri.userInfo == null && uri.fragment == null) { "Untrusted authentication endpoint" }
      val connection = uri.toURL().openConnection() as HttpsURLConnection
      try {
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 30000
        connection.readTimeout = 30000
        connection.setRequestProperty("Accept", "application/json")
        if (form != null) {
          require(form.length <= 131072) { "Authentication request too large" }
          connection.requestMethod = "POST"
          connection.doOutput = true
          connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
          connection.outputStream.use { it.write(form.toByteArray(Charsets.UTF_8)) }
        }
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val output = ByteArrayOutputStream()
        stream?.use {
          val buffer = ByteArray(8192)
          while (true) {
            val count = it.read(buffer)
            if (count < 0) break
            require(output.size() + count <= 262144) { "Authentication response too large" }
            output.write(buffer, 0, count)
          }
        }
        val bytes = output.toByteArray()
        mapOf("status" to status, "bodyText" to String(bytes, Charsets.UTF_8))
      } finally { connection.disconnect() }
      } catch (error: Exception) {
        val categories = setOf("UnknownHostException", "SSLHandshakeException", "SSLPeerUnverifiedException", "SocketTimeoutException", "NetworkOnMainThreadException", "ConnectException", "SecurityException")
        var current: Throwable? = error
        var category = error.javaClass.simpleName
        repeat(5) { if (current != null) { if (current!!.javaClass.simpleName in categories) category = current!!.javaClass.simpleName; current = current!!.cause } }
        // Category only: never return request data, tokens, URLs or exception messages.
        mapOf("status" to 0, "bodyText" to "{\"error\":\"native_transport\",\"category\":\"$category\"}")
      }
    }
    OnDestroy { receiver?.close(); receiver = null }
    AsyncFunction("selfTest") { state: String ->
      LoopbackReceiver(state).use { receiver ->
        val response = Socket("127.0.0.1", receiver.port()).use { socket ->
          socket.soTimeout = 5000
          socket.getOutputStream().write("GET /auth/callback?state=$state&code=local-self-test HTTP/1.1\r\nHost: 127.0.0.1:${receiver.port()}\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
          socket.getInputStream().bufferedReader().readText()
        }
        val callback = receiver.await(5000)
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val publicKey = pair.public as RSAPublicKey
        val signature = Signature.getInstance("SHA256withRSA").apply { initSign(pair.private); update("local-self-test".toByteArray(Charsets.US_ASCII)) }.sign()
        val verified = RsaVerifier.verify("local-self-test", signature, publicKey.modulus.toByteArray(), publicKey.publicExponent.toByteArray())
        mapOf("callbackVerified" to (response.startsWith("HTTP/1.1 200") && callback.contains("code=local-self-test")), "signatureVerified" to verified, "boundAddress" to "127.0.0.1")
      }
    }
  }
}
