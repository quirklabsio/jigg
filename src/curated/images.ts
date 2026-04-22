export interface CuratedImage {
  src: string;
  label: string;
  forceGrid?: { cols: number; rows: number };
}

export const CURATED_IMAGES: CuratedImage[] = [
  {
    src: '/curated/color-blocks-3x3.png',
    label: 'Regression test (3×3)',
    forceGrid: { cols: 3, rows: 3 },
  },
  {
    src: '/curated/earthrise.jpg',
    label: 'Earthrise (NASA, 1968)',
  },
  {
    src: '/curated/great-wave.jpg',
    label: 'The Great Wave (Hokusai)',
  },
  {
    src: '/curated/starry-night.jpg',
    label: 'The Starry Night (Van Gogh)',
  },
  {
    src: '/curated/sunflowers.jpg',
    label: 'Sunflowers (Van Gogh)',
  },
  {
    src: '/curated/girl-with-pearl-earring.jpg',
    label: 'Girl with a Pearl Earring (Vermeer)',
  },
  {
    src: '/curated/water-lilies.jpg',
    label: 'Water Lilies (Monet)',
  },
];
