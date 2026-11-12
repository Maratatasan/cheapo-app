package expo.modules.cheapoloopback;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** A bounded, one-use receiver. It never binds a LAN interface or logs requests. */
public final class LoopbackReceiver implements AutoCloseable {
  private final ServerSocket server;
  private final String state;
  private final String returnLink;
  private final CompletableFuture<String> callback = new CompletableFuture<>();
  public LoopbackReceiver(String expectedState) throws IOException {
    this(expectedState, false);
  }
  public LoopbackReceiver(String expectedState, boolean fieldApp) throws IOException {
    if(expectedState == null || expectedState.length() < 32) throw new IllegalArgumentException("State is too short");
    state = expectedState;
    returnLink = fieldApp ? "<a href='cheapofield://direct-auth'>Return to Cheapo Field</a>"
        : "<a href='cheapo-auth-test://direct-auth'>Return to Cheapo Auth Test</a>";
    server = new ServerSocket();
    server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 1);
    server.setSoTimeout(600000);
    Thread worker = new Thread(this::receive, "cheapo-loopback");
    worker.setDaemon(true);
    worker.start();
  }
  public int port() { return server.getLocalPort(); }
  public String await(long timeoutMillis) throws Exception { return callback.get(timeoutMillis, TimeUnit.MILLISECONDS); }
  private void receive() {
    try {
      for(int attempt=0;attempt<8;attempt++) {
        try(Socket client=server.accept()) {
          client.setSoTimeout(5000);
          ByteArrayOutputStream headers=new ByteArrayOutputStream();
          InputStream input=client.getInputStream();
          while(headers.size()<8192) {
            int next=input.read();if(next<0)break;headers.write(next);
            if(headers.toString(StandardCharsets.US_ASCII.name()).endsWith("\r\n\r\n"))break;
          }
          String request=headers.toString(StandardCharsets.US_ASCII.name());
          String[] first=request.split("\r\n",2)[0].split(" ");
          URI target=first.length==3 ? URI.create(first[1]) : URI.create("/");
          String query=target.getRawQuery();
          boolean valid=first.length==3 && "GET".equals(first[0]) && !target.isAbsolute() && "/auth/callback".equals(target.getPath()) && request.toLowerCase().contains("\r\nhost: 127.0.0.1:"+port()+"\r\n") && query!=null;
          String returnedState=null;
          if(query!=null) for(String field:query.split("&")) {
            String[] pair=field.split("=",2);
            if("state".equals(pair[0]) && pair.length==2) {
              if(returnedState!=null) {valid=false;break;}
              returnedState=URLDecoder.decode(pair[1], StandardCharsets.UTF_8.name());
            }
          }
          valid=valid && state.equals(returnedState);
          byte[] body=(valid ? "<!doctype html><meta name=viewport content=width=device-width><h1>Sign-in received</h1><p>Return to Cheapo to finish verification.</p>" + returnLink : "Invalid callback.").getBytes(StandardCharsets.UTF_8);
          OutputStream output=client.getOutputStream();
          output.write(("HTTP/1.1 "+(valid?"200 OK":"400 Bad Request")+"\r\nContent-Type: "+(valid?"text/html":"text/plain")+"; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: "+body.length+"\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
          output.write(body);output.flush();
          if(valid) {callback.complete(target.toString());return;}
        }
      }
      throw new IOException("Too many invalid callbacks");
    }catch(Exception error) {callback.completeExceptionally(new IOException("Callback unavailable"));}
    finally {try{server.close();}catch(IOException ignored){}}
  }
  @Override public void close() throws IOException {server.close();callback.cancel(false);}
}
