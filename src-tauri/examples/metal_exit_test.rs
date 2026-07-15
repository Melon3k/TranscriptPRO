//! Control experiment for the exit-time SIGABRT after a Metal transcription.
//!
//! ggml's Metal device singleton is destroyed by C++ static destructors inside
//! libc `exit()`; `ggml_metal_rsets_free` asserts that no Metal residency sets
//! remain, so exiting with a live `WhisperContext` aborts.
//!
//! Usage: metal_exit_test <model.bin> <audio.wav> <leak|drop>
//!   leak — keep the context alive across `exit()` (models the cached context
//!          never being dropped): expected to SIGABRT.
//!   drop — free the context before `exit()` (models the fix): expected exit 0.

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn read_wav_pcm_f32(path: &str) -> Vec<f32> {
    let data = std::fs::read(path).expect("read wav");
    assert!(data.len() > 44 && &data[0..4] == b"RIFF" && &data[8..12] == b"WAVE");
    let mut pos = 12;
    while pos + 8 < data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size =
            u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
                as usize;
        if chunk_id == b"data" {
            let pcm = &data[pos + 8..(pos + 8 + chunk_size).min(data.len())];
            return pcm
                .chunks_exact(2)
                .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
                .collect();
        }
        pos += 8 + chunk_size + chunk_size % 2;
    }
    panic!("no data chunk");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (model, wav, mode) = (&args[1], &args[2], args[3].as_str());

    let samples = read_wav_pcm_f32(wav);
    eprintln!("[test] {} samples loaded", samples.len());

    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu(true);
    let ctx = WhisperContext::new_with_params(model, ctx_params).expect("load model");

    let mut state = ctx.create_state().expect("create state");
    state
        .full(FullParams::new(SamplingStrategy::Greedy { best_of: 1 }), &samples)
        .expect("full");
    eprintln!("[test] {} segments transcribed on GPU", state.full_n_segments());
    drop(state);

    match mode {
        "leak" => std::mem::forget(ctx),
        "drop" => drop(ctx),
        other => panic!("unknown mode {other}"),
    }
    eprintln!("[test] calling std::process::exit(0) (mode={mode})");
    std::process::exit(0);
}
