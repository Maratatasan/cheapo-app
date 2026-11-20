import { useEffect, useState } from 'react';

export type ProductPhotoSource = (id: string) => { cached: Promise<string | undefined>; current: Promise<string | undefined> };

export function useProductPhotoUri(source?: ProductPhotoSource, productId?: string | null, visible = true) {
  const [result, setResult] = useState<{ source: ProductPhotoSource; productId: string; uri?: string }>();
  useEffect(() => {
    if (!source || !productId || !visible) return;
    let current = true;
    const update = (uri?: string) => { if (current) setResult({ source, productId, uri }); };
    const request = source(productId);
    void request.cached.then(update);
    void request.current.then(update);
    return () => { current = false; };
  }, [source, productId, visible]);

  return result && result.source === source && result.productId === productId ? result.uri : undefined;
}
