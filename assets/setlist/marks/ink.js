/* Turns stored mark data into Fabric objects, and finds what the eraser touches.
 *
 * Everything is stored in "scene" units: the chart is always SCENE_WIDTH wide,
 * whatever the screen or zoom, so marks line up on every device.
 *
 *   { t: 'pen' | 'highlighter', c: colour, s: size, p: [x, y, pressure, ...], sim?: 1 }
 *   { t: 'text', c: colour, s: size, x, y, text, rtl?: 1 }
 */
import { FabricText, Path, Point } from '../../vendor/fabric-7.4.0.min.mjs';
import { getStroke } from '../../vendor/perfect-freehand-1.2.3.mjs';

export const SCENE_WIDTH = 1000;

const HIGHLIGHTER_OPACITY = 0.35;
const INERT = { selectable: false, evented: false, objectCaching: false };

/** Outline polygon to SVG path, with quadratic curves between the midpoints. */
function outlineToPath(outline) {
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const f = (n) => n.toFixed(2);
    let d = `M ${f(outline[0][0])} ${f(outline[0][1])}`;
    for (let i = 0; i < outline.length; i++) {
        const point = outline[i];
        const [mx, my] = mid(point, outline[(i + 1) % outline.length]);
        d += ` Q ${f(point[0])} ${f(point[1])} ${f(mx)} ${f(my)}`;
    }
    return `${d} Z`;
}

function toPoints(flat) {
    const points = [];
    for (let i = 0; i + 2 < flat.length; i += 3) points.push([flat[i], flat[i + 1], flat[i + 2]]);
    return points;
}

function strokeObject(data) {
    const highlighter = data.t === 'highlighter';
    const outline = getStroke(toPoints(data.p), {
        size: data.s,
        thinning: highlighter ? 0 : 0.6,
        smoothing: 0.5,
        streamline: 0.4,
        simulatePressure: !!data.sim,
        last: true,
    });
    if (outline.length < 3) return null;
    return new Path(outlineToPath(outline), {
        ...INERT,
        fill: data.c,
        stroke: null,
        opacity: highlighter ? HIGHLIGHTER_OPACITY : 1,
    });
}

function textObject(data) {
    return new FabricText(data.text, {
        ...INERT,
        left: data.x,
        top: data.y,
        originX: data.rtl ? 'right' : 'left',
        originY: 'center',
        fill: data.c,
        fontSize: data.s,
        fontFamily: 'Heebo, Arial, sans-serif',
        direction: data.rtl ? 'rtl' : 'ltr',
        textAlign: data.rtl ? 'right' : 'left',
    });
}

/** The Fabric object for one mark, or null if it has nothing to draw. */
export function toObject(data) {
    try {
        return data.t === 'text' ? textObject(data) : strokeObject(data);
    } catch (err) {
        console.warn('Skipping a mark that could not be drawn', err);
        return null;
    }
}

function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True when an eraser of this radius at (x, y) touches the mark. */
export function touches(data, object, x, y, radius) {
    if (data.t === 'text') return !!object?.containsPoint(new Point(x, y));
    const reach = radius + data.s / 2;
    const p = data.p;
    if (p.length <= 3) return Math.hypot(x - p[0], y - p[1]) <= reach;
    for (let i = 0; i + 5 < p.length; i += 3) {
        if (distanceToSegment(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= reach) return true;
    }
    return false;
}
