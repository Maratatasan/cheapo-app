package expo.modules.cheapoloopback;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.RSAPublicKeySpec;
/** Cryptographic primitive only; JWT algorithm/key selection and claims remain explicit. */
public final class RsaVerifier {
  public static boolean verify(String signingInput,byte[] signature,byte[] modulus,byte[] exponent) throws GeneralSecurityException {
    if(signingInput.length()>65536 || signature.length>1024 || modulus.length>1024 || exponent.length>16) return false;
    try {
      PublicKey key=KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(new BigInteger(1,modulus),new BigInteger(1,exponent)));
      Signature verifier=Signature.getInstance("SHA256withRSA");
      verifier.initVerify(key);verifier.update(signingInput.getBytes(StandardCharsets.US_ASCII));
      return verifier.verify(signature);
    }catch(IllegalArgumentException invalid){return false;}
  }
}
