import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MobileDraft } from '../component/mobile-draft';

describe('development mobile draft', () => {
  const originalReader = globalThis.FileReader;
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalReader) globalThis.FileReader = originalReader;
    else Reflect.deleteProperty(globalThis, 'FileReader');
  });
  it.each([
    {unitPrice:{amount:1.25,unit:'kg'},expected:'£1.25 / kg'},
    {unitPrice:null,expected:'Unit price unavailable'},
  ])('waits for explicit submission and displays unit price $expected', async ({unitPrice,expected}) => {
    const network = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok:true, blob:async()=>({size:3,type:'image/jpeg'}) } as Response)
      .mockResolvedValueOnce({ok:true,json:async()=>({draft:{product:'Potatoes',price:2.5,currency:'GBP',unit_price:unitPrice,uncertainty:''},model:'gpt-5.6-luna'})} as Response);
    Object.defineProperty(globalThis,'FileReader',{configurable:true,writable:true,value:class {
      result = 'data:image/jpeg;base64,/9j/';
      onload?: () => void;
      readAsDataURL() { this.onload?.(); }
    }});
    await render(<MobileDraft photoUri="http://10.0.2.2:8767/test-photo.jpg" />);
    expect(network).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByPlaceholderText('Mac pairing code'),'test-pairing');
    await fireEvent.press(screen.getByText('Analyse test photo'));
    expect(await screen.findByText('Potatoes')).toBeOnTheScreen();
    expect(screen.getByText('£2.50')).toBeOnTheScreen();
    expect(screen.getByText(expected)).toBeOnTheScreen();
    expect(screen.queryByText(/\"product\":/)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Show response details'));
    expect(screen.getByText(/\"product\": \"Potatoes\"/)).toBeOnTheScreen();
    expect(network).toHaveBeenLastCalledWith('http://10.0.2.2:8768/mobile/draft',expect.objectContaining({method:'POST',body:JSON.stringify({image:'data:image/jpeg;base64,/9j/'})}));
  });
  it('shows a useful companion failure without retrying', async()=>{
    const network=jest.spyOn(globalThis,'fetch').mockRejectedValue(Error('Network failed'));
    await render(<MobileDraft photoUri="http://10.0.2.2:8767/test-photo.jpg" />);
    await fireEvent.changeText(screen.getByPlaceholderText('Mac pairing code'),'test-pairing');
    await fireEvent.press(screen.getByText('Analyse test photo'));
    expect(await screen.findByText(/Network failed/)).toBeOnTheScreen();
    expect(network).toHaveBeenCalledTimes(1);
  });
});
