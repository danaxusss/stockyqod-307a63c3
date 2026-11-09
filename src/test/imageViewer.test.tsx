import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ImageViewer } from '../components/ImageViewer';

describe('full-screen image viewer', () => {
  it('zooms on tap, and Escape closes only the viewer', () => {
    const onClose = vi.fn();
    const outerEscape = vi.fn();
    window.addEventListener('keydown', outerEscape);
    render(<ImageViewer src="https://cdn.test/poster.jpg" alt="Four mixte" onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'Four mixte' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus();
    const img = screen.getByRole('img', { name: 'Four mixte' });
    fireEvent.click(img, { clientX: 0, clientY: 0 });
    expect(img.style.transform).toBe('scale(2.2)');
    fireEvent.click(img);
    expect(img.style.transform).toBe('');
    expect(onClose).not.toHaveBeenCalled();

    // The dialog under it (product quick view) listens for Escape too.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outerEscape).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outerEscape);
  });
});
