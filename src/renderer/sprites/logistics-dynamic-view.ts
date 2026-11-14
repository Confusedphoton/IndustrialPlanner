import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { LogisticsMaterialEntityState, LogisticsMaterialFrameState } from '@/shared/logistics-material';
import type { LogisticsDynamicAssets } from '../texture';

/** 管身/支架前层和物流标记使用共享相位图集；流体与支架后层由路线场景统一绘制。 */
export class LogisticsDynamicView {
  public readonly root = new Container();
  private readonly supports: Sprite[] = [];
  private middleSupport: Sprite | null = null;
  private readonly markers: Sprite[] = [];
  private readonly moving: { sprite: Sprite; clip: string; pass: 'arrow' | 'highlight' | 'pattern' | 'chevron' }[] = [];
  private previousState: LogisticsMaterialEntityState | null = null;
  private previousTime = Number.NaN;
  private previousVisual = '';
  private readonly colors: { sprite: Sprite; role: string }[] = [];
  private shell: Sprite | null = null;
  private overlay: Sprite | null = null;
  private readonly head = new Graphics();

  public constructor(private readonly assets: LogisticsDynamicAssets, state: LogisticsMaterialEntityState, private readonly entityId = '') {
    this.root.pivot.set(64, 64);
    this.root.label = `logistics-material:${entityId}`;
    const add = (key: string) => {
      const sprite = new Sprite(this.texture(key));
      sprite.anchor.set(.5); sprite.position.set(64, 64);
      sprite.scale.set(128 / assets.manifest.pixelsPerCell);
      this.root.addChild(sprite); return sprite;
    };
    const animated = (pass: 'arrow' | 'highlight' | 'pattern' | 'chevron') => {
      const clip = `${state.kind === 'belt' ? 'conveyor' : 'pipe'}/${state.shape}/${pass}`;
      const frame = assets.manifest.clips[clip]?.frames[0];
      if (!frame) throw new Error(`Missing baked clip: ${clip}`);
      const sprite = add(frame);
      if (pass !== 'pattern') sprite.label = 'logistics-material-flow';
      this.moving.push({ sprite, clip, pass });
      if (state.kind === 'belt') this.colors.push({ sprite, role: pass });
    };
    if (state.kind === 'belt') {
      const layers = assets.manifest.tintableConveyor?.[state.shape];
      if (!layers) throw new Error('Missing tintable conveyor layers');
      for (const role of ['surface', 'edge-glow', 'edge-core']) {
        this.colors.push({ sprite: add(layers.static[role]!), role });
      }
      this.overlay = add(`ui/belt-connectable/${state.shape}`);
      animated('highlight'); animated('arrow');
    } else {
      // 正式管道中支架由路线场景放在反射层之前，虚影没有正式路线。
      this.middleSupport = add(`static/pipe.${state.shape}.support-middle`);
      this.shell = add(`static/pipe.${state.shape}.shell`);
      this.overlay = add(`ui/hover/${state.shape}`);
      animated('chevron');
      if (state.shape === 'straight') {
        this.markers.push(add('static/pipe.straight.static-logo-glow'));
        this.markers.push(add('static/pipe.straight.static-logo-core'));
      }
      this.supports.push(add(`static/pipe.${state.shape}.support-front`));
    }
    this.overlay.visible = false;
    this.overlay.label = 'logistics-material-effect';
    this.head.label = 'logistics-preview-head';
    if (state.kind === 'belt') {
      this.head.poly([16, 16, 112, 16, 64, 64]).fill(0xffeb80)
        .poly([112, 16, 112, 112, 64, 64]).fill(0xffe268)
        .poly([112, 112, 16, 112, 64, 64]).fill(0xeac143)
        .poly([16, 112, 16, 16, 64, 64]).fill(0xf6d555);
    } else {
      this.head.poly([52, 26, 76, 26, 76, 65, 97, 65, 64, 100, 31, 65, 52, 65]).fill(0xffffff);
    }
    for (const [x, y, dx, dy] of [[5, 5, 1, 1], [123, 5, -1, 1], [5, 123, 1, -1], [123, 123, -1, -1]]) {
      this.head.moveTo(x! + dx! * 22, y!).lineTo(x!, y!).lineTo(x!, y! + dy! * 22).stroke({ width: 4, color: 0xffdf73 });
    }
    this.head.visible = false;
    this.head.pivot.set(64, 64); this.head.position.set(64, 64);
    this.head.rotation = state.shape === 'straight' ? 0 : state.shape === 'left' ? Math.PI / 2 : -Math.PI / 2;
    this.root.addChild(this.head);
  }

  private texture(key: string): Texture {
    const texture = this.assets.textures.get(key);
    if (!texture) throw new Error(`Missing baked texture: ${key}`);
    return texture;
  }

  public sync(state: LogisticsMaterialEntityState, frame: LogisticsMaterialFrameState): void {
    const time = state.kind === 'belt' || state.preview ? frame.beltSeconds : state.pipeFlow?.seconds ?? 0;
    const effect = frame.effects?.get(this.entityId);
    const reflected = frame.pipeWallReflection === true && !state.preview && !effect;
    const head = state.preview === true && frame.previewHeadId === this.entityId;
    const visual = `${effect}:${reflected}:${head}`;
    if (this.previousState === state && this.previousTime === time && this.previousVisual === visual) return;
    this.previousVisual = visual;
    this.head.visible = head;
    if (this.shell) this.shell.visible = !reflected;
    if (this.overlay) {
      this.overlay.visible = state.kind === 'belt' ? effect === 'connectable' : effect !== undefined;
      if (this.overlay.visible) {
        this.overlay.texture = this.texture(`ui/${state.kind === 'belt' ? 'belt-connectable' : effect === 'invalid' ? 'preview' : effect}/${state.shape}`);
        this.overlay.tint = effect === 'selected' ? 0x67caff : effect === 'invalid' ? 0xff655d
          : effect === 'connectable' || effect === 'hover' ? 0xfff4dc : 0xffffff;
      }
    }
    for (const { sprite, role } of this.colors) {
      const normal = this.assets.manifest.tintableConveyor![state.shape].defaultColors[role]!;
      sprite.tint = effect === 'selected' ? role === 'surface' ? 0x51b8ed : 0xbcf0ff
        : effect === 'preview' ? 0xffffff : effect === 'invalid' ? 0xff655d
        : effect === 'connectable' && role.startsWith('edge') ? 0xfff7e3
        : (Math.round(normal[0] * 255) << 16) | (Math.round(normal[1] * 255) << 8) | Math.round(normal[2] * 255);
    }
    this.previousState = state; this.previousTime = time;
    for (const support of this.supports) support.visible = state.support;
    // 预览提交会复用 Sprite；支架和标识必须跟随新拓扑更新，不能固定在构造时。
    if (this.middleSupport) this.middleSupport.visible = state.preview === true && state.support;
    for (const marker of this.markers) marker.visible = state.marker;
    const id = state.kind === 'pipe' ? 'log_pipe_02_mid' : `grid_belt_01_${state.shape === 'straight' ? 'mid' : state.shape}`;
    const p = this.assets.manifest.parametersByResourceId[id]!;
    const start = state.start + 5;
    const q = start * (2 * p.waterDirection! - 1) - p.flowOffset!;
    for (const { sprite, clip, pass } of this.moving) {
      const phase = pass === 'arrow' ? start - time * p.arrowSpeed!
        : pass === 'highlight' ? (start - time * p.flowSpeed! + p.timeOffset!) * p.flowSpace!
        : pass === 'pattern' ? q * p.staticDensity! : (q + p.flowSpeed! * time) * p.flowDensity!;
      const sequence = this.assets.manifest.clips[clip]!;
      const fraction = phase - Math.floor(phase);
      sprite.texture = this.texture((state.kind === 'belt' ? sequence.tintFrames! : sequence.frames)[Math.round(fraction * sequence.phaseSamples) % sequence.phaseSamples]!);
    }
  }

  public destroy(): void { this.root.destroy({ children: true }); }
}

