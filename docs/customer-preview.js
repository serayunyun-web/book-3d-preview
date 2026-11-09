(() => {
  'use strict';

  const viewer = document.querySelector('#book-model');
  const status = document.querySelector('#color-status');
  const colorNotice = '顏色僅供參考，實際商品可能因螢幕顯示與光線而有色差。';
  const buttons = [...document.querySelectorAll('.swatch')];
  const sourceTexture = 'assets/textures/tan_leather_derived_v1.png';
  const cache = new Map();
  let sourcePixelsPromise;
  let leather;
  let originalTexture;
  let originalColor;
  let requestId = 0;

  function setSelected(name) {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.color === name));
    }
  }

  function readPixels() {
    if (!sourcePixelsPromise) {
      sourcePixelsPromise = (async () => {
        const image = new Image();
        image.src = sourceTexture;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const histogram = new Uint32Array(256);
        let count = 0;
        for (let i = 0; i < pixels.data.length; i += 16) {
          if (pixels.data[i + 3] === 0) continue;
          const luminance = Math.round(0.2126 * pixels.data[i] + 0.7152 * pixels.data[i + 1] + 0.0722 * pixels.data[i + 2]);
          histogram[luminance]++;
          count++;
        }
        let accumulated = 0;
        let median = 1;
        for (let i = 0; i < histogram.length; i++) {
          accumulated += histogram[i];
          if (accumulated >= count / 2) {
            median = Math.max(1, i);
            break;
          }
        }
        return { pixels, median, width: canvas.width, height: canvas.height };
      })().catch((error) => {
        sourcePixelsPromise = undefined;
        throw error;
      });
    }
    return sourcePixelsPromise;
  }

  async function makeTintedTexture(hex) {
    const { pixels, median, width, height } = await readPixels();
    const target = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const tinted = context.createImageData(width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const luminance = 0.2126 * pixels.data[i] + 0.7152 * pixels.data[i + 1] + 0.0722 * pixels.data[i + 2];
      const ratio = luminance / median;
      for (let channel = 0; channel < 3; channel++) {
        tinted.data[i + channel] = Math.min(255, Math.round(target[channel] * ratio));
      }
      tinted.data[i + 3] = pixels.data[i + 3];
    }
    context.putImageData(tinted, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('無法產生皮革顏色')), 'image/png');
    });
    const url = URL.createObjectURL(blob);
    try {
      return await viewer.createTexture(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  viewer.addEventListener('load', () => {
    leather = viewer.model?.materials.find((material) => material.name === 'MAT_Tan_Leather');
    if (!leather?.pbrMetallicRoughness.baseColorTexture?.texture) {
      status.textContent = '無法切換封面顏色：模型缺少皮革貼圖。';
      return;
    }
    originalTexture = leather.pbrMetallicRoughness.baseColorTexture.texture;
    originalColor = [...leather.pbrMetallicRoughness.baseColorFactor];
    buttons.forEach((button) => { button.disabled = false; });
    status.textContent = colorNotice;
  });

  viewer.addEventListener('error', () => {
    status.textContent = '書本模型載入失敗，請稍後再試。';
  });

  for (const button of buttons) {
    button.addEventListener('click', async () => {
      if (!leather || button.disabled) return;
      const name = button.dataset.color;
      const currentRequest = ++requestId;
      const pbr = leather.pbrMetallicRoughness;
      if (name === 'original') {
        pbr.baseColorTexture.setTexture(originalTexture);
        pbr.setBaseColorFactor([...originalColor]);
        setSelected(name);
        status.textContent = colorNotice;
        return;
      }
      const hex = button.dataset.hex;
      status.textContent = `正在套用${button.textContent.trim()}…`;
      try {
        if (!cache.has(hex)) {
          cache.set(hex, makeTintedTexture(hex).catch((error) => {
            cache.delete(hex);
            throw error;
          }));
        }
        const texture = await cache.get(hex);
        if (currentRequest !== requestId) return;
        pbr.baseColorTexture.setTexture(texture);
        pbr.setBaseColorFactor([...originalColor]);
        setSelected(name);
        status.textContent = colorNotice;
      } catch (error) {
        if (currentRequest !== requestId) return;
        status.textContent = '顏色套用失敗，請再選一次。';
        console.error(error);
      }
    });
  }
})();
