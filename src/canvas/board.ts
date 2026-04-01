import { Container, Graphics } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';

/**
 * Create the board card — a soft white rectangle that communicates the puzzle
 * area without any border, grid lines, or slot markers.
 *
 * A DropShadowFilter on the Container gives it gentle lift off the background.
 * The Container is what gets added to stage; the Graphics is an internal child.
 *
 * zIndex = -1 — always below all piece containers (which start at 0..n-1).
 */
export function createBoard(
  imageWidth:   number,
  imageHeight:  number,
  cols:         number,
  rows:         number,
  scale:        number,
  screenWidth:  number,
  screenHeight: number,
): Container {
  void cols; void rows; // reserved for future slot rendering

  const bw   = imageWidth  * scale;
  const bh   = imageHeight * scale;
  const left = (screenWidth  - bw) / 2;
  const top  = (screenHeight - bh) / 2;

  const g = new Graphics();
  g.rect(left, top, bw, bh);
  g.fill({ color: 0xffffff });

  const container = new Container();
  container.addChild(g);
  container.zIndex = -1;

  const shadow = new DropShadowFilter({
    offset:     { x: 0, y: 8 },
    blur:       24,
    alpha:      0.06,
    color:      0x000000,
    quality:    3,
    resolution: window.devicePixelRatio ?? 1,
  });
  container.filters = [shadow];

  return container;
}
