import { useMemo, useRef, useState } from 'react';
import { Alert, Button, Image, Modal, PanResponder, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PhotoAsset } from '@/data/local-photo';
import { cropPhoto } from '@/lib/photo-crop';
import { dragCrop, fullPhoto, type CropBox, type CropDrag } from '@/data/crop-geometry';

export function PhotoCrop({ original, initialBox = fullPhoto, onCancel, onApply }: { original: PhotoAsset; initialBox?: CropBox; onCancel: () => void; onApply: (photo: PhotoAsset, box: CropBox) => void }) {
  const [box, setBox] = useState<CropBox>(initialBox);
  const boxRef = useRef(box);
  boxRef.current = box;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  // Leave space around the original so the handles remain reachable at its edges.
  const ratio = Math.max(0, Math.min((layout.width - 48) / original.width, (layout.height - 48) / original.height));
  const width = original.width * ratio;
  const height = original.height * ratio;
  const responders = useMemo(() => {
    const create = (mode: CropDrag) => {
      let start = fullPhoto;
      return PanResponder.create({
        onStartShouldSetPanResponder: () => !busyRef.current,
        onMoveShouldSetPanResponder: () => !busyRef.current,
        onPanResponderGrant: () => { start = boxRef.current; },
        onPanResponderMove: (_, gesture) => {
          if (width && height && !busyRef.current) setBox(dragCrop(start, mode, gesture.dx / width, gesture.dy / height));
        },
        onPanResponderTerminationRequest: () => false,
      }).panHandlers;
    };
    return { move: create('move'), 'top-left': create('top-left'), 'top-right': create('top-right'), 'bottom-left': create('bottom-left'), 'bottom-right': create('bottom-right') };
  }, [width, height]);
  async function apply() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { onApply(await cropPhoto(original, box), box); }
    catch { Alert.alert('Unable to crop photo', 'Your original is kept. Try again or cancel.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <Modal visible onRequestClose={() => { if (!busyRef.current) onCancel(); }}>
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Crop price photo</Text>
      <Text style={styles.text}>Drag a corner to resize the box. Drag inside to move it. Your full original stays visible and is kept.</Text>
      <View testID="crop-stage" style={styles.stage} onLayout={event => setLayout(event.nativeEvent.layout)}>
        {width > 0 && height > 0 ? <View style={{ width, height }}>
          <Image pointerEvents="none" accessibilityLabel="Full original photo" source={{ uri: original.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          <View pointerEvents="none" style={[styles.shade, { left: 0, top: 0, width, height: box.top * height }]} />
          <View pointerEvents="none" style={[styles.shade, { left: 0, top: box.bottom * height, width, height: (1 - box.bottom) * height }]} />
          <View pointerEvents="none" style={[styles.shade, { left: 0, top: box.top * height, width: box.left * width, height: (box.bottom - box.top) * height }]} />
          <View pointerEvents="none" style={[styles.shade, { left: box.right * width, top: box.top * height, width: (1 - box.right) * width, height: (box.bottom - box.top) * height }]} />
          <View accessibilityLabel="Move crop box" {...responders.move} style={[styles.box, { left: box.left * width, top: box.top * height, width: (box.right - box.left) * width, height: (box.bottom - box.top) * height }]}>
            {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map(corner => <View key={corner} accessible accessibilityLabel={`${corner} crop handle`} accessibilityRole="adjustable" accessibilityActions={[{ name: 'increment', label: 'Move corner down and right' }, { name: 'decrement', label: 'Move corner up and left' }]} onAccessibilityAction={event => {
              if (!busyRef.current) setBox(current => dragCrop(current, corner, event.nativeEvent.actionName === 'increment' ? 0.02 : -0.02, event.nativeEvent.actionName === 'increment' ? 0.02 : -0.02));
            }} {...responders[corner]} style={[styles.handle, corner.startsWith('top') ? { top: -24 } : { bottom: -24 }, corner.endsWith('left') ? { left: -24 } : { right: -24 }]}><View style={styles.dot} /></View>)}
          </View>
        </View> : null}
      </View>
      <Text style={styles.text}>Area to keep: {Math.round((box.right - box.left) * 100)}% wide · {Math.round((box.bottom - box.top) * 100)}% high</Text>
      <Button title="Reset" disabled={busy} onPress={() => setBox(fullPhoto)} />
      <Button title={busy ? 'Cropping…' : 'Use crop'} disabled={busy} onPress={apply} />
      <Button title="Cancel" disabled={busy} onPress={onCancel} />
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#111', padding: 16, gap: 12 }, stage: { flex: 1, alignItems: 'center', justifyContent: 'center' }, title: { color: '#fff', fontSize: 22, fontWeight: 'bold' }, text: { color: '#fff', textAlign: 'center' }, shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' }, box: { position: 'absolute', borderWidth: 2, borderColor: '#77ff99' }, handle: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, dot: { width: 20, height: 20, backgroundColor: '#fff', borderColor: '#24a35a', borderWidth: 3, borderRadius: 5 } });
