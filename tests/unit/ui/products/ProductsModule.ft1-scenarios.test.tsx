// tests/unit/ui/products/ProductsModule.ft1-scenarios.test.tsx

import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import ProductsModule from '@lasyncro/products';
import type ProductsUiIntent from '@lasyncro/products';
import { renderWithTheme } from 'test-utils';

describe('ProductsModule – FT1 scenarios', () => {
  test('NO_PRODUCTS shows CTA and emits add-products intent', () => {
    const onIntent = jest.fn();

    renderWithTheme(
      <ProductsModule
        productCount={0}
        productHealthEvents={null}
        excludedProductCount={null}
        onIntent={onIntent}
      />
    );

    expect(
      screen.getByText('No products available')
    ).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: /add products/i });
    fireEvent.click(cta);

    expect(onIntent).toHaveBeenCalledWith({
      type: 'START_ONBOARDING',
      taskId: 'add-products',
    });
  });

  test('PRODUCT_DATA_INCOMPLETE shows CTA and emits complete-product-data intent', () => {
    const onIntent = jest.fn();

    renderWithTheme(
      <ProductsModule
        productCount={5}
        productHealthEvents={0}
        excludedProductCount={null}
        onIntent={onIntent}
      />
    );

    expect(
      screen.getByText('Product data incomplete')
    ).toBeInTheDocument();

    const cta = screen.getByRole('button', {
      name: /complete product data/i,
    });
    fireEvent.click(cta);

    expect(onIntent).toHaveBeenCalledWith({
      type: 'START_ONBOARDING',
      taskId: 'complete-product-data',
    });
  });

  test('PARTIALLY_READY shows CTA and emits review-product-readiness intent', () => {
    const onIntent = jest.fn();

    renderWithTheme(
      <ProductsModule
        productCount={10}
        productHealthEvents={4}
        excludedProductCount={6}
        onIntent={onIntent}
      />
    );

    expect(
      screen.getByText('Product health partially available')
    ).toBeInTheDocument();

    const cta = screen.getByRole('button', {
      name: /review excluded products/i,
    });
    fireEvent.click(cta);

    expect(onIntent).toHaveBeenCalledWith({
      type: 'START_ONBOARDING',
      taskId: 'review-product-readiness',
    });
  });

  test('HEALTHY renders no CTA', () => {
    const onIntent = jest.fn();

    renderWithTheme(
      <ProductsModule
        productCount={4}
        productHealthEvents={2}
        excludedProductCount={0}
        onIntent={onIntent}
      />
    );

    expect(
      screen.getByText('Products are ready')
    ).toBeInTheDocument();

    expect(screen.queryByRole('button')).toBeNull();
    expect(onIntent).not.toHaveBeenCalled();
  });
});
