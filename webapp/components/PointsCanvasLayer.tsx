/**
 * All points of the national view on one canvas.
 *
 * React-Leaflet makes a component and a Leaflet layer per marker; at 100,000+
 * points (Italy) that alone freezes the browser. This draws every point in view
 * onto a single canvas after each pan or zoom (positions are projected once, at
 * zoom 0, and only scaled per redraw), and finds the clicked point through a
 * screen grid. It draws what the simple circle markers drew: carrier series
 * colour, white ring, the hourly render priority (the caller passes the points
 * in that order), grey for points outside a highlight, and the spiderfy spread
 * with its legs at zoom 15 and above.
 */
'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { PakketpuntFeature, PakketpuntProperties } from '@/types/pakketpunten';

export interface PointsCanvasLayerProps {
  /** Points in draw order (lowest priority first). */
  points: PakketpuntFeature[];
  colorOf: (carrier: string) => string;
  radius: number;
  opacity: number;
  highlightedPoints: Set<string> | null;
  onPointClick: (props: PakketpuntProperties, latlng: L.LatLng) => void;
}

const PANE = 'points-canvas';
const PADDING = 0.25; // canvas overhang per side, as a share of the map size
const SPIDERFY_ZOOM = 15;
const SPIDER_RADIUS_DEG = 0.00015; // ~15 m, as the marker spiderfy
const HIT_SLOP = 3; // px beyond the dot that still counts as a hit
const CELL = 24; // hit-test grid cell, px

const rgbaCache = new Map<string, string>();
/** '#rrggbb' + opacity → 'rgba(...)' (cached; the draw loop asks per dot). */
function withAlpha(hex: string, alpha: number): string {
  const key = hex + alpha;
  let rgba = rgbaCache.get(key);
  if (!rgba) {
    const n = parseInt(hex.slice(1), 16);
    rgba = hex.length === 7 ? `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})` : hex;
    rgbaCache.set(key, rgba);
  }
  return rgba;
}

const highlightKey = (p: PakketpuntProperties) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;

class PointsCanvas extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private props: PointsCanvasLayerProps;
  // Projected position of each point at zoom 0
  private x0 = new Float64Array(0);
  private y0 = new Float64Array(0);
  // What the last redraw put on screen (container px), in draw order, for hit tests
  private drawnIndex: number[] = [];
  private drawnX: number[] = [];
  private drawnY: number[] = [];
  private grid = new Map<number, number[]>();
  private hitRadius = 0;
  private frame = 0;

  constructor(props: PointsCanvasLayerProps) {
    super();
    this.props = props;
  }

  setProps(props: PointsCanvasLayerProps) {
    const prev = this.props;
    this.props = props;
    if (props.points !== prev.points) this.project();
    const looksChanged =
      props.points !== prev.points ||
      props.radius !== prev.radius ||
      props.opacity !== prev.opacity ||
      props.highlightedPoints !== prev.highlightedPoints ||
      props.colorOf !== prev.colorOf;
    if (looksChanged) this.scheduleRedraw();
  }

  onAdd(map: L.Map) {
    if (!map.getPane(PANE)) {
      const pane = map.createPane(PANE);
      // Above the coverage panes and boundaries (overlay 400), below markers (600)
      pane.style.zIndex = '450';
      pane.style.pointerEvents = 'none';
    }
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide') as HTMLCanvasElement;
    this.canvas.style.pointerEvents = 'none';
    map.getPane(PANE)!.appendChild(this.canvas);
    this.project();
    map.on('moveend zoomend resize viewreset', this.scheduleRedraw, this);
    map.on('click', this.handleClick, this);
    map.on('mousemove', this.handleHover, this);
    this.redraw();
    return this;
  }

  onRemove(map: L.Map) {
    map.off('moveend zoomend resize viewreset', this.scheduleRedraw, this);
    map.off('click', this.handleClick, this);
    map.off('mousemove', this.handleHover, this);
    cancelAnimationFrame(this.frame);
    this.canvas?.remove();
    this.canvas = null;
    map.getContainer().style.cursor = '';
    return this;
  }

  private project() {
    const map = this._map;
    if (!map) return;
    const { points } = this.props;
    this.x0 = new Float64Array(points.length);
    this.y0 = new Float64Array(points.length);
    points.forEach((f, i) => {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      const p = map.project([lat, lng], 0);
      this.x0[i] = p.x;
      this.y0[i] = p.y;
    });
  }

  private scheduleRedraw() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.redraw());
  }

  private redraw() {
    const map = this._map;
    const canvas = this.canvas;
    if (!map || !canvas) return;
    const { points, colorOf, radius, opacity, highlightedPoints } = this.props;

    const size = map.getSize();
    const padX = Math.round(size.x * PADDING);
    const padY = Math.round(size.y * PADDING);
    const width = size.x + 2 * padX;
    const height = size.y + 2 * padY;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([-padX, -padY]));

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Container position = zoom-0 projection × scale − (pixel origin − map pane offset)
    const zoom = map.getZoom();
    const scale = map.options.crs!.scale(zoom) / map.options.crs!.scale(0);
    const origin = map.getPixelOrigin().subtract(map.containerPointToLayerPoint([0, 0]).multiplyBy(-1));
    const ox = origin.x - padX;
    const oy = origin.y - padY;
    const margin = radius + 2;

    // Points in view, in draw order, as canvas px
    const visible: number[] = [];
    const vx: number[] = [];
    const vy: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const x = this.x0[i] * scale - ox;
      const y = this.y0[i] * scale - oy;
      if (x < -margin || y < -margin || x > width + margin || y > height + margin) continue;
      visible.push(i);
      vx.push(x);
      vy.push(y);
    }

    // Spread points that share a position at high zoom, with a leg back to it
    const legs: [number, number, number, number][] = [];
    if (zoom >= SPIDERFY_ZOOM) {
      const groups = new Map<string, number[]>();
      visible.forEach((i, k) => {
        const key = `${this.x0[i]},${this.y0[i]}`;
        const group = groups.get(key);
        if (group) group.push(k);
        else groups.set(key, [k]);
      });
      groups.forEach((group) => {
        if (group.length < 2) return;
        const [lng, lat] = points[visible[group[0]]].geometry.coordinates as [number, number];
        group.forEach((k, index) => {
          const angle = (2 * Math.PI * index) / group.length;
          const spread = map.latLngToContainerPoint([
            lat + Math.sin(angle) * SPIDER_RADIUS_DEG,
            lng + Math.cos(angle) * SPIDER_RADIUS_DEG,
          ]);
          const x = spread.x + padX;
          const y = spread.y + padY;
          legs.push([vx[k], vy[k], x, y]);
          vx[k] = x;
          vy[k] = y;
        });
      });
    }

    const started = performance.now();
    ctx.clearRect(0, 0, width, height);
    if (legs.length > 0) {
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of legs) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.strokeStyle = 'rgba(59,130,246,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Points outside a highlight first (grey, smaller), then the rest. Each dot
    // gets its own fill and ring, as the circle markers did, so dense areas stay
    // a mosaic of dots; the fill opacity is baked into an rgba colour, so the
    // loop changes no canvas state but the colours.
    const highlighted = (k: number) =>
      !highlightedPoints || highlightedPoints.has(highlightKey(points[visible[k]].properties as PakketpuntProperties));
    const drawPass = (wantHighlighted: boolean) => {
      const r = wantHighlighted ? radius : radius - 1;
      ctx.strokeStyle = wantHighlighted ? '#ffffff' : '#d1d5db';
      ctx.lineWidth = 1;
      const alpha = wantHighlighted ? opacity : 0.4;
      for (let k = 0; k < visible.length; k++) {
        if (highlighted(k) !== wantHighlighted) continue;
        const props = points[visible[k]].properties as PakketpuntProperties;
        ctx.fillStyle = withAlpha(wantHighlighted ? colorOf(props.vervoerder) : '#9ca3af', alpha);
        ctx.beginPath();
        ctx.arc(vx[k], vy[k], r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    };
    if (highlightedPoints) drawPass(false);
    drawPass(true);
    canvas.dataset.drawMs = String(Math.round(performance.now() - started));
    canvas.dataset.drawn = String(visible.length);

    // Hit-test index in container px; later entries are drawn on top
    this.hitRadius = radius + HIT_SLOP;
    this.drawnIndex = visible;
    this.drawnX = vx.map((x) => x - padX);
    this.drawnY = vy.map((y) => y - padY);
    this.grid = new Map();
    for (let k = 0; k < visible.length; k++) {
      const cell = this.cellKey(this.drawnX[k], this.drawnY[k]);
      const bucket = this.grid.get(cell);
      if (bucket) bucket.push(k);
      else this.grid.set(cell, [k]);
    }
  }

  private cellKey(x: number, y: number) {
    return Math.floor(x / CELL) * 100003 + Math.floor(y / CELL);
  }

  /** The topmost drawn point under a container position, as an index into `drawnIndex`. */
  private hit(p: L.Point): number {
    const cx = Math.floor(p.x / CELL);
    const cy = Math.floor(p.y / CELL);
    let best = -1;
    const r2 = this.hitRadius * this.hitRadius;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const k of this.grid.get((cx + dx) * 100003 + cy + dy) ?? []) {
          const ddx = this.drawnX[k] - p.x;
          const ddy = this.drawnY[k] - p.y;
          if (ddx * ddx + ddy * ddy <= r2 && k > best) best = k;
        }
      }
    }
    return best;
  }

  private handleClick(e: L.LeafletMouseEvent) {
    const k = this.hit(e.containerPoint);
    if (k < 0) return;
    const feature = this.props.points[this.drawnIndex[k]];
    const latlng = this._map!.containerPointToLatLng([this.drawnX[k], this.drawnY[k]]);
    this.props.onPointClick(feature.properties as PakketpuntProperties, latlng);
  }

  private handleHover(e: L.LeafletMouseEvent) {
    this._map!.getContainer().style.cursor = this.hit(e.containerPoint) >= 0 ? 'pointer' : '';
  }
}

export default function PointsCanvasLayer(props: PointsCanvasLayerProps) {
  const map = useMap();
  const layerRef = useRef<PointsCanvas | null>(null);

  useEffect(() => {
    const layer = new PointsCanvas(props);
    layerRef.current = layer;
    layer.addTo(map);
    return () => {
      layer.remove();
      layerRef.current = null;
    };
    // Created once per map; later prop changes go through setProps below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    layerRef.current?.setProps(props);
  });

  return null;
}
