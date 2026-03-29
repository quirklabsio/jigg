use wasm_bindgen::prelude::*;

// ─── Cut generation ──────────────────────────────────────────────────────────

/// Deterministic hash for an edge (col, row, direction: 0=horizontal 1=vertical).
fn hash_edge(col: u32, row: u32, dir: u32) -> u32 {
    let mut h = col.wrapping_mul(2654435761);
    h ^= row.wrapping_mul(2246822519);
    h ^= dir.wrapping_mul(2654435761);
    h ^= h >> 16;
    h
}

/// Mulberry32 PRNG — returns a closure yielding f32 in [0, 1).
fn mulberry32(seed: u32) -> impl FnMut() -> f32 {
    let mut s = seed;
    move || {
        s = s.wrapping_add(0x6D2B79F5);
        let mut z = s;
        z = (z ^ (z >> 15)).wrapping_mul(z | 1);
        z ^= z.wrapping_add((z ^ (z >> 7)).wrapping_mul(z | 61));
        ((z ^ (z >> 14)) as f32) / (u32::MAX as f32 + 1.0)
    }
}

// Bezier constant for approximating a quarter-circle arc.
// Two of these segments form a near-perfect semicircular dome.
const K: f32 = 0.5523;

/// Generate the 19-point path (1 start + 6 × 3) for a horizontal cut.
///
/// Profile: smooth waist dip at baseline → shoulder flare → narrow neck →
/// two quarter-circle arcs forming a round dome head.
/// tab_dy: signed — positive = protrudes downward (+Y), negative = upward.
fn horizontal_tab_path(
    x_left: f32,
    x_right: f32,
    cut_y: f32,
    tab_center_x: f32,
    tab_dy: f32,
    tab_w: f32,       // head diameter (widest point)
    neck_w: f32,      // neck width (narrowest passage)
    shoulder_w: f32,  // shoulder width (slight flare before neck)
) -> Vec<[f32; 2]> {
    let cx = tab_center_x;
    let sgn = if tab_dy >= 0.0 { 1.0f32 } else { -1.0f32 };
    let waist_depth = 5.0f32;
    let waist_y = cut_y - sgn * waist_depth; // dips inward, away from tab direction

    let r  = tab_w / 2.0;             // head radius
    let nl = cx - neck_w / 2.0;       // neck left
    let nr = cx + neck_w / 2.0;       // neck right
    let sl = cx - shoulder_w / 2.0;   // shoulder left
    let sr = cx + shoulder_w / 2.0;   // shoulder right
    let hl = cx - r;                   // head left
    let hr = cx + r;                   // head right

    // neck_y: where the circular dome begins.
    // tip_y = neck_y + sgn*r  →  dome height = r, dome width = 2r (dome shape).
    let neck_y = cut_y + tab_dy - sgn * r;
    let tip_y  = cut_y + tab_dy;

    vec![
        // P0
        [x_left, cut_y],
        // Seg 1: flat approach → shoulder + waist dip → pinch to neck-left at baseline
        [x_left + (sl - x_left) * 0.6, cut_y],
        [sl, waist_y],
        [nl, cut_y],
        // Seg 2: neck-left rises and widens into the dome entry (smooth S)
        [nl, cut_y + (neck_y - cut_y) * 0.4],
        [hl, cut_y + (neck_y - cut_y) * 0.75],
        [hl, neck_y],
        // Seg 3: left quarter-circle arc — head-left → tip (G1 smooth)
        [hl, neck_y + sgn * r * K],
        [cx - r * K, tip_y],
        [cx, tip_y],
        // Seg 4: right quarter-circle arc — tip → head-right (G1 smooth)
        [cx + r * K, tip_y],
        [hr, neck_y + sgn * r * K],
        [hr, neck_y],
        // Seg 5: head-right descends back through neck (mirror of Seg 2)
        [hr, cut_y + (neck_y - cut_y) * 0.75],
        [nr, cut_y + (neck_y - cut_y) * 0.4],
        [nr, cut_y],
        // Seg 6: neck-right → shoulder + waist dip → flat departure
        [sr, waist_y],
        [x_right - (x_right - sr) * 0.6, cut_y],
        [x_right, cut_y],
    ]
}

/// Generate the 19-point path for a vertical cut.
/// tab_dx: positive = protrudes rightward (+X), negative = leftward.
fn vertical_tab_path(
    y_top: f32,
    y_bottom: f32,
    cut_x: f32,
    tab_center_y: f32,
    tab_dx: f32,
    tab_w: f32,       // head height along edge (Y)
    neck_w: f32,
    shoulder_w: f32,
) -> Vec<[f32; 2]> {
    let cy = tab_center_y;
    let sgn = if tab_dx >= 0.0 { 1.0f32 } else { -1.0f32 };
    let waist_depth = 5.0f32;
    let waist_x = cut_x - sgn * waist_depth;

    let r  = tab_w / 2.0;
    let nt = cy - neck_w / 2.0;
    let nb = cy + neck_w / 2.0;
    let st = cy - shoulder_w / 2.0;
    let sb = cy + shoulder_w / 2.0;
    let ht = cy - r;   // head top
    let hb = cy + r;   // head bottom

    // neck_x: where dome begins.  tip_x = neck_x + sgn*r.
    let neck_x = cut_x + tab_dx - sgn * r;
    let tip_x  = cut_x + tab_dx;

    vec![
        // P0
        [cut_x, y_top],
        // Seg 1: flat → shoulder + waist dip → neck-top at cut_x
        [cut_x, y_top + (st - y_top) * 0.6],
        [waist_x, st],
        [cut_x, nt],
        // Seg 2: neck-top expands into dome entry
        [cut_x + (neck_x - cut_x) * 0.4, nt],
        [cut_x + (neck_x - cut_x) * 0.75, ht],
        [neck_x, ht],
        // Seg 3: top quarter-circle arc — head-top → tip (G1)
        [neck_x + sgn * r * K, ht],
        [tip_x, cy - r * K],
        [tip_x, cy],
        // Seg 4: bottom quarter-circle arc — tip → head-bottom (G1)
        [tip_x, cy + r * K],
        [neck_x + sgn * r * K, hb],
        [neck_x, hb],
        // Seg 5: head-bottom descends back (mirror of Seg 2)
        [cut_x + (neck_x - cut_x) * 0.75, hb],
        [cut_x + (neck_x - cut_x) * 0.4, nb],
        [cut_x, nb],
        // Seg 6: neck-bottom → shoulder + waist dip → flat departure
        [waist_x, sb],
        [cut_x, y_bottom - (y_bottom - sb) * 0.6],
        [cut_x, y_bottom],
    ]
}

fn points_to_json(pts: &[[f32; 2]]) -> String {
    let inner: Vec<String> = pts
        .iter()
        .map(|p| format!("{{\"x\":{:.4},\"y\":{:.4}}}", p[0], p[1]))
        .collect();
    format!("[{}]", inner.join(","))
}

/// Generate interlocking cut paths for all interior grid edges.
///
/// Returns a JSON string (array of CutPath objects) because passing structured
/// data through wasm-bindgen without serde is cleanest as a serialised string.
#[wasm_bindgen]
pub fn generate_cuts(
    cols: u32,
    rows: u32,
    piece_width: f32,
    piece_height: f32,
    seed: u32,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    // ── Horizontal cuts  (between row r and row r+1) ────────────────────────
    for row in 0..rows.saturating_sub(1) {
        for col in 0..cols {
            let cut_y = (row + 1) as f32 * piece_height;
            let x_left = col as f32 * piece_width;
            let x_right = (col + 1) as f32 * piece_width;

            let h = hash_edge(col, row, 0);
            let has_tab = if h % 2 == 0 { "A" } else { "B" };

            let edge_seed = h.wrapping_add(seed);
            let mut rng = mulberry32(edge_seed);

            let tab_offset = (rng() - 0.5) * 0.2 * piece_width;
            let tab_center_x = (x_left + x_right) / 2.0 + tab_offset;
            let raw_h = piece_height * 0.25 * (1.0 + (rng() - 0.5) * 0.3);
            let tab_w = piece_width * 0.20 * (1.0 + (rng() - 0.5) * 0.3);
            let neck_w = tab_w * 0.50 * (1.0 + (rng() - 0.5) * 0.2);
            let shoulder_w = tab_w * 0.85;

            // A's tab protrudes DOWN (+Y), B's tab protrudes UP (−Y).
            let tab_dy = if has_tab == "A" { raw_h } else { -raw_h };

            let pts = horizontal_tab_path(x_left, x_right, cut_y, tab_center_x, tab_dy, tab_w, neck_w, shoulder_w);

            parts.push(format!(
                "{{\"colA\":{},\"rowA\":{},\"colB\":{},\"rowB\":{},\
                 \"direction\":\"horizontal\",\"hasTab\":\"{}\",\"points\":{}}}",
                col, row, col, row + 1, has_tab, points_to_json(&pts)
            ));
        }
    }

    // ── Vertical cuts  (between col c and col c+1) ──────────────────────────
    for col in 0..cols.saturating_sub(1) {
        for row in 0..rows {
            let cut_x = (col + 1) as f32 * piece_width;
            let y_top = row as f32 * piece_height;
            let y_bottom = (row + 1) as f32 * piece_height;

            let h = hash_edge(col, row, 1);
            let has_tab = if h % 2 == 0 { "A" } else { "B" };

            let edge_seed = h.wrapping_add(seed);
            let mut rng = mulberry32(edge_seed);

            let tab_offset = (rng() - 0.5) * 0.2 * piece_height;
            let tab_center_y = (y_top + y_bottom) / 2.0 + tab_offset;
            let raw_h = piece_width * 0.25 * (1.0 + (rng() - 0.5) * 0.3);
            let tab_w = piece_height * 0.20 * (1.0 + (rng() - 0.5) * 0.3);
            let neck_w = tab_w * 0.50 * (1.0 + (rng() - 0.5) * 0.2);
            let shoulder_w = tab_w * 0.85;

            // A's tab protrudes RIGHT (+X), B's tab protrudes LEFT (−X).
            let tab_dx = if has_tab == "A" { raw_h } else { -raw_h };

            let pts = vertical_tab_path(y_top, y_bottom, cut_x, tab_center_y, tab_dx, tab_w, neck_w, shoulder_w);

            parts.push(format!(
                "{{\"colA\":{},\"rowA\":{},\"colB\":{},\"rowB\":{},\
                 \"direction\":\"vertical\",\"hasTab\":\"{}\",\"points\":{}}}",
                col, row, col + 1, row, has_tab, points_to_json(&pts)
            ));
        }
    }

    format!("[{}]", parts.join(","))
}

// ─── Canny edge detection ────────────────────────────────────────────────────

/// Canny edge detection.
/// Input: RGBA pixel buffer (width * height * 4 bytes).
/// Output: edge map, same dimensions, 255 = edge pixel, 0 = non-edge pixel.
#[wasm_bindgen]
pub fn analyze_image(pixels: &[u8], width: u32, height: u32) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let n = w * h;

    // Step 1: RGBA → greyscale
    let grey: Vec<f32> = (0..n)
        .map(|i| {
            let r = pixels[i * 4] as f32;
            let g = pixels[i * 4 + 1] as f32;
            let b = pixels[i * 4 + 2] as f32;
            0.299 * r + 0.587 * g + 0.114 * b
        })
        .collect();

    // Step 2: 5×5 Gaussian blur, sigma=1.4
    let blurred = gaussian_blur(&grey, w, h);

    // Step 3: Sobel — gradient magnitude + direction
    let (gx_arr, gy_arr, magnitude) = sobel(&blurred, w, h);

    // Step 4: Non-maximum suppression
    let nms = non_max_suppression(&magnitude, &gx_arr, &gy_arr, w, h);

    // Step 5 & 6: Double threshold + hysteresis
    let max_mag = nms.iter().cloned().fold(0.0f32, f32::max);
    let high = 0.15 * max_mag;
    let low = 0.05 * max_mag;
    hysteresis(&nms, w, h, low, high)
}

fn gaussian_blur(grey: &[f32], w: usize, h: usize) -> Vec<f32> {
    // Build and normalise 5×5 Gaussian kernel at runtime (sigma=1.4)
    let sigma = 1.4f32;
    let mut kernel = [[0.0f32; 5]; 5];
    let mut sum = 0.0f32;
    for ky in 0..5usize {
        for kx in 0..5usize {
            let dx = kx as f32 - 2.0;
            let dy = ky as f32 - 2.0;
            let v = (-(dx * dx + dy * dy) / (2.0 * sigma * sigma)).exp();
            kernel[ky][kx] = v;
            sum += v;
        }
    }
    for row in kernel.iter_mut() {
        for val in row.iter_mut() {
            *val /= sum;
        }
    }

    let mut out = vec![0.0f32; w * h];
    for py in 0..h {
        for px in 0..w {
            let mut acc = 0.0f32;
            for ky in 0..5usize {
                let iy = py as isize + ky as isize - 2;
                if iy < 0 || iy >= h as isize {
                    continue;
                }
                for kx in 0..5usize {
                    let ix = px as isize + kx as isize - 2;
                    if ix < 0 || ix >= w as isize {
                        continue;
                    }
                    acc += grey[iy as usize * w + ix as usize] * kernel[ky][kx];
                }
            }
            out[py * w + px] = acc;
        }
    }
    out
}

fn sobel(grey: &[f32], w: usize, h: usize) -> (Vec<f32>, Vec<f32>, Vec<f32>) {
    let gx_kernel: [[f32; 3]; 3] = [[-1.0, 0.0, 1.0], [-2.0, 0.0, 2.0], [-1.0, 0.0, 1.0]];
    let gy_kernel: [[f32; 3]; 3] = [[-1.0, -2.0, -1.0], [0.0, 0.0, 0.0], [1.0, 2.0, 1.0]];

    let mut gx_arr = vec![0.0f32; w * h];
    let mut gy_arr = vec![0.0f32; w * h];
    let mut magnitude = vec![0.0f32; w * h];

    for py in 1..h - 1 {
        for px in 1..w - 1 {
            let mut gx = 0.0f32;
            let mut gy = 0.0f32;
            for ky in 0..3usize {
                for kx in 0..3usize {
                    let v = grey[(py + ky - 1) * w + (px + kx - 1)];
                    gx += v * gx_kernel[ky][kx];
                    gy += v * gy_kernel[ky][kx];
                }
            }
            let idx = py * w + px;
            gx_arr[idx] = gx;
            gy_arr[idx] = gy;
            magnitude[idx] = (gx * gx + gy * gy).sqrt();
        }
    }
    (gx_arr, gy_arr, magnitude)
}

fn non_max_suppression(
    magnitude: &[f32],
    gx: &[f32],
    gy: &[f32],
    w: usize,
    h: usize,
) -> Vec<f32> {
    let mut out = vec![0.0f32; w * h];
    for py in 1..h - 1 {
        for px in 1..w - 1 {
            let idx = py * w + px;
            let mag = magnitude[idx];

            // Gradient direction in degrees, normalised to [0, 180)
            let angle_deg = gy[idx].atan2(gx[idx]).to_degrees();
            let angle_norm = ((angle_deg % 180.0) + 180.0) % 180.0;

            let (n1, n2) = if angle_norm < 22.5 || angle_norm >= 157.5 {
                // 0°  — compare left/right
                (magnitude[idx - 1], magnitude[idx + 1])
            } else if angle_norm < 67.5 {
                // 45° — compare NE/SW
                (magnitude[(py - 1) * w + px + 1], magnitude[(py + 1) * w + px - 1])
            } else if angle_norm < 112.5 {
                // 90° — compare up/down
                (magnitude[(py - 1) * w + px], magnitude[(py + 1) * w + px])
            } else {
                // 135° — compare NW/SE
                (magnitude[(py - 1) * w + px - 1], magnitude[(py + 1) * w + px + 1])
            };

            if mag >= n1 && mag >= n2 {
                out[idx] = mag;
            }
        }
    }
    out
}

fn hysteresis(nms: &[f32], w: usize, h: usize, low: f32, high: f32) -> Vec<u8> {
    let n = w * h;

    // Classify each pixel: 0=none, 1=weak, 2=strong
    let mut edge_type = vec![0u8; n];
    for i in 0..n {
        if nms[i] >= high {
            edge_type[i] = 2;
        } else if nms[i] >= low {
            edge_type[i] = 1;
        }
    }

    let mut result = vec![0u8; n];

    // Seed queue with all strong pixels
    let mut queue: Vec<usize> = edge_type
        .iter()
        .enumerate()
        .filter(|(_, &v)| v == 2)
        .map(|(i, _)| i)
        .collect();

    for &i in &queue {
        result[i] = 255;
    }

    // BFS: promote weak pixels connected to strong pixels
    let mut head = 0;
    while head < queue.len() {
        let idx = queue[head];
        head += 1;
        let py = idx / w;
        let px = idx % w;
        if py == 0 || py >= h - 1 || px == 0 || px >= w - 1 {
            continue;
        }
        for dy in -1i32..=1 {
            for dx in -1i32..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let ni = ((py as i32 + dy) as usize) * w + ((px as i32 + dx) as usize);
                if edge_type[ni] == 1 && result[ni] == 0 {
                    result[ni] = 255;
                    edge_type[ni] = 2; // mark visited so it's not enqueued twice
                    queue.push(ni);
                }
            }
        }
    }

    result
}
