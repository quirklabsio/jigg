use wasm_bindgen::prelude::*;

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
