import { Application, Assets, Sprite, Texture } from 'pixi.js';

function fitSprite(sprite: Sprite, screenWidth: number, screenHeight: number): void {
  const scale = Math.min(
    screenWidth / sprite.texture.width,
    screenHeight / sprite.texture.height,
  );
  sprite.scale.set(scale);
  sprite.position.set(screenWidth / 2, screenHeight / 2);
}

export async function loadScene(app: Application, imageUrl: string): Promise<void> {
  const texture = await Assets.load<Texture>(imageUrl);
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  fitSprite(sprite, app.screen.width, app.screen.height);
  app.stage.addChild(sprite);

  app.renderer.on('resize', (width: number, height: number) => {
    fitSprite(sprite, width, height);
  });
}
