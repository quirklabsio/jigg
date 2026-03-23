use wasm_bindgen::prelude::*;

/// Placeholder: returns the byte length of the pixel buffer.
/// For a width×height RGBA image this equals width * height * 4.
#[wasm_bindgen]
pub fn analyze_image(pixels: &[u8], _width: u32, _height: u32) -> u32 {
    pixels.len() as u32
}
