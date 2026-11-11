import expo.modules.cheapoloopback.*;
import java.net.*;
import java.security.*;
import java.security.interfaces.RSAPublicKey;
public final class NativePrimitivesTest {
  static void check(boolean value) {if(!value)throw new AssertionError("Native primitive failed");}
  public static void main(String[] args) throws Exception {
    String state="01234567890123456789012345678901";
    try(LoopbackReceiver receiver=new LoopbackReceiver(state)) {
      HttpURLConnection bad=(HttpURLConnection)new URL("http://127.0.0.1:"+receiver.port()+"/auth/callback?state=wrong").openConnection();check(bad.getResponseCode()==400);bad.disconnect();
      HttpURLConnection good=(HttpURLConnection)new URL("http://127.0.0.1:"+receiver.port()+"/auth/callback?state="+state+"&code=mock-code").openConnection();check(good.getResponseCode()==200);good.getInputStream().close();good.disconnect();
      check(receiver.await(5000).contains("code=mock-code"));
    }
    KeyPair pair=KeyPairGenerator.getInstance("RSA").generateKeyPair();RSAPublicKey key=(RSAPublicKey)pair.getPublic();
    Signature signer=Signature.getInstance("SHA256withRSA");signer.initSign(pair.getPrivate());signer.update("signed-input".getBytes("US-ASCII"));
    byte[] signed=signer.sign(),n=key.getModulus().toByteArray(),exponent=key.getPublicExponent().toByteArray();
    check(RsaVerifier.verify("signed-input",signed,n,exponent));check(!RsaVerifier.verify("tampered-input",signed,n,exponent));
    System.out.println("Loopback valid/invalid state and RS256 valid/tampered signature passed; no provider requests.");
  }
}
