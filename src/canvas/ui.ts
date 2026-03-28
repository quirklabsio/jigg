import { Application, Container, Graphics, Text } from 'pixi.js';

const PAD_X = 40;
const PAD_Y = 20;
const FADE_DURATION_MS = 2000;

export function showCompletionMessage(app: Application): void {
  const label = new Text({
    text: 'Puzzle complete.',
    style: { fill: 0xffffff, fontSize: 32 },
  });
  label.anchor.set(0.5);

  const panelW = label.width + PAD_X * 2;
  const panelH = label.height + PAD_Y * 2;
  const cx = app.screen.width / 2;
  const cy = app.screen.height / 2;

  const panel = new Graphics();
  panel.roundRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 8);
  panel.fill({ color: 0x000000, alpha: 0.6 });

  label.x = cx;
  label.y = cy;

  const ui = new Container();
  ui.zIndex = 9999;
  ui.alpha = 0;
  ui.addChild(panel);
  ui.addChild(label);
  app.stage.addChild(ui);

  const start = performance.now();
  const tickerFn = () => {
    const t = Math.min((performance.now() - start) / FADE_DURATION_MS, 1);
    ui.alpha = t;
    if (t >= 1) app.ticker.remove(tickerFn);
  };
  app.ticker.add(tickerFn);
}
