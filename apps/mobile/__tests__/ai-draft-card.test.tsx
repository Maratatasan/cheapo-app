import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { AiDraftCard } from '../component/results/ai-draft-card';
it('uses the shared observation card for a real draft without sample shop or date values',async()=>{
  await render(<AiDraftCard draft={{product:'Albert Bartlett Rooster Potatoes 2kg',price:2.5,currency:'GBP',unit_price:{amount:1.25,unit:'kg'},uncertainty:'Check the offer conditions.'}} />);
  expect(screen.getByLabelText('Observation: Shop unconfirmed, £2.50')).toBeOnTheScreen();
  expect(screen.getByText('£1.25 / kg')).toBeOnTheScreen();
  expect(screen.getByText('Observation date unconfirmed · Distance unknown')).toBeOnTheScreen();
  expect(screen.getByText('Check the offer conditions.')).toBeOnTheScreen();
  expect(screen.queryByText(/Sample observation|Lidl|Colliers Wood/)).not.toBeOnTheScreen();
});
it('keeps unknown price and currency explicit',async()=>{
  await render(<AiDraftCard draft={{product:null,price:null,currency:null,unit_price:null,uncertainty:''}} />);
  expect(screen.getByText('Product unconfirmed')).toBeOnTheScreen();
  expect(screen.getByText('Price to review')).toBeOnTheScreen();
  expect(screen.getByText('Unit price unavailable')).toBeOnTheScreen();
});
