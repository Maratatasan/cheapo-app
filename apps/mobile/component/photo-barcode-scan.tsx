import { useRef } from 'react';
import type { PermissionResponse } from 'expo-camera';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraActionButton, CameraPermissionActions } from './camera-actions';
import { ProductBarcodeCamera } from './product-barcode-camera';

export const cameraPermissionMessage = 'Camera access is off. Enter the product barcode manually.';

export function PhotoBarcodeScan({ permission, requestPermission, onCancel, onRead, onError }: {
  permission: PermissionResponse;
  requestPermission: () => Promise<PermissionResponse>;
  onCancel: () => void;
  onRead: (code: string) => void;
  onError: (message: string) => void;
}) {
  const closed = useRef(false);
  const requesting = useRef(false);

  function finish(action: () => void) {
    if (closed.current) return;
    closed.current = true;
    action();
  }

  const cancel = () => finish(onCancel);
  async function grant() {
    if (closed.current || requesting.current) return;
    requesting.current = true;
    try {
      if (!(await requestPermission()).granted) finish(() => onError(cameraPermissionMessage));
    } catch {
      finish(() => onError(cameraPermissionMessage));
    } finally {
      requesting.current = false;
    }
  }

  return (
    <Modal visible onRequestClose={cancel}>
      <View style={styles.page}>
        {permission.granted ? (
          <>
            <ProductBarcodeCamera
              onRead={code => finish(() => onRead(code))}
              onError={() => finish(() => onError('Couldn’t open the camera. Enter the product barcode manually.'))}
            />
            <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.footer}>
              <Text style={styles.guide}>Point the camera at the product barcode.</Text>
              <CameraActionButton label="Cancel scan" onPress={cancel} />
            </SafeAreaView>
          </>
        ) : (
          <SafeAreaView style={styles.permission}>
            <CameraPermissionActions onGrant={() => { void grant(); }} disabled={!permission.canAskAgain}>
              <CameraActionButton label="Cancel scan" onPress={cancel} />
            </CameraPermissionActions>
          </SafeAreaView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000' },
  permission: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  footer: { padding: 16, gap: 8 },
  guide: { color: '#fff', textAlign: 'center' },
});
