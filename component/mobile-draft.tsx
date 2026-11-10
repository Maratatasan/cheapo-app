import { useRef, useState } from 'react';
import { Button, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AiDraftCard } from './results/ai-draft-card';
import type { AiPriceDraft } from '@/data/ai-observation';

// Emulator-only development UI. Provider credentials remain in the Mac process.
export function MobileDraft({ photoUri }: { photoUri: string }) {
  const [pairing, setPairing] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [result, setResult] = useState('');
  const [draft, setDraft] = useState<AiPriceDraft | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  async function analyse() {
    if (pending.current || !pairing.trim()) return;
    pending.current = true;
    setVisible(true); setBusy(true); setDraft(null); setShowDebug(false); setResult('Reading selected photo…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 125_000);
    try {
      const photo = await fetch(photoUri, { signal:controller.signal });
      if (!photo.ok) throw Error('Test photo unavailable. Check the local photo server.');
      const blob = await photo.blob();
      if (blob.size > 5_900_000) throw Error('Test photo exceeds 5.9 MB.');
      const image = await new Promise<string>((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(Error('Could not read selected photo.'));
        reader.onerror = () => reject(Error('Could not read selected photo.'));
        reader.readAsDataURL(blob);
      });
      setResult('Waiting for ChatGPT plan draft…');
      const companion = new URL(process.env.EXPO_PUBLIC_CHEAPO_COMPANION_URL || 'http://10.0.2.2:8768');
      if (companion.protocol !== 'http:' || !['127.0.0.1','10.0.2.2'].includes(companion.hostname) || companion.username || companion.password) throw Error('Use a loopback or emulator companion URL.');
      const response = await fetch(`${companion.origin}/mobile/draft`, {
        method:'POST', headers:{'Content-Type':'application/json','X-Cheapo-Pairing':pairing.trim()},
        body:JSON.stringify({image}), signal:controller.signal,
      });
      const value = await response.json();
      if (!response.ok) {
        const diagnostic = value.diagnostics;
        throw Error([value.error || 'Draft request failed.', diagnostic?.status ? `HTTP ${diagnostic.status}` : '', diagnostic?.code, diagnostic?.requestId].filter(Boolean).join(' · '));
      }
      setDraft(value.draft);
      setResult(`Model: ${value.model}\n${JSON.stringify(value.draft,null,2)}${value.requestId ? `\nRequest: ${value.requestId}` : ''}`);
    } catch (error) {
      setResult(`No draft accepted. ${error instanceof Error ? error.message : 'Request failed.'}\nCheck the local photo server, Mac sign-in and pairing code. No automatic retry was sent.`);
    } finally {
      clearTimeout(timeout); pending.current = false; setBusy(false);
    }
  }
  return <>
    <View style={styles.controls}>
      <TextInput placeholder="Mac pairing code" accessibilityLabel="Mac pairing code" secureTextEntry autoCapitalize="none" autoCorrect={false} value={pairing} onChangeText={setPairing} style={styles.input} />
      <Button title="Analyse test photo" disabled={!pairing.trim() || busy} onPress={analyse} />
      <Text style={styles.note}>Sends this photo to OpenAI using your ChatGPT plan.</Text>
    </View>
    <Modal visible={visible} onRequestClose={() => { if (!busy) setVisible(false); }}>
      <View style={styles.result}>
        <Text accessibilityRole="header">Test photo AI result</Text>
        <ScrollView contentContainerStyle={{gap:16}}>
          {draft ? <>
            <AiDraftCard draft={draft} />
            <Button title={showDebug ? 'Hide response details' : 'Show response details'} onPress={() => setShowDebug(!showDebug)} />
            {showDebug ? <Text selectable>{result}</Text> : null}
          </> : <Text selectable>{result}</Text>}
        </ScrollView>
        <Button title={busy ? 'Analysing…' : 'Back to preview'} disabled={busy} onPress={() => setVisible(false)} />
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  controls:{backgroundColor:'#fff',padding:8,width:300,borderRadius:8,marginBottom:12},
  input:{borderWidth:1,borderColor:'#777',padding:8,color:'#000',marginBottom:4},
  note:{fontSize:11,color:'#333',marginTop:4},
  result:{flex:1,padding:24,paddingTop:48,gap:20,backgroundColor:'#fff'},
});
