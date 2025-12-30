//! SmolLM2 WASM inference library for browser-based LLM.
//!
//! This module provides WebAssembly bindings for running SmolLM2-135M
//! language model inference directly in the browser without server processing.

use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::llama::{Cache, Config, Llama, LlamaConfig};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tokenizers::Tokenizer;
use wasm_bindgen::prelude::*;

// Console logging for debugging
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
    #[wasm_bindgen(js_namespace = console)]
    fn error(s: &str);
}

/// Macro for console logging in WASM context.
macro_rules! console_log {
    ($($t:tt)*) => (log(&format!($($t)*)))
}

/// Generation parameters for text completion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationParams {
    /// Maximum number of tokens to generate.
    pub max_tokens: usize,
    /// Temperature for sampling (0.0 = greedy, higher = more random).
    pub temperature: f64,
    /// Top-p (nucleus) sampling threshold.
    pub top_p: f64,
    /// Repeat penalty to avoid repetitive text.
    pub repeat_penalty: f32,
    /// Number of tokens to consider for repeat penalty.
    pub repeat_last_n: usize,
    /// Random seed for reproducibility.
    pub seed: u64,
}

impl Default for GenerationParams {
    fn default() -> Self {
        Self {
            max_tokens: 256,
            temperature: 0.7,
            top_p: 0.9,
            repeat_penalty: 1.1,
            repeat_last_n: 64,
            seed: 42,
        }
    }
}

/// SmolLM2 model wrapper for WASM.
pub struct SmolLM2Model {
    model: Llama,
    tokenizer: Tokenizer,
    /// Model configuration, stored for potential future use (model introspection, cache reset, etc.)
    _config: Config,
    device: Device,
    cache: Cache,
}

/// Static model storage for the worker context.
static MODEL: Mutex<Option<SmolLM2Model>> = Mutex::new(None);

/// Initialize panic hook for better error messages.
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Get the library version.
#[wasm_bindgen]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Check if model is loaded.
#[wasm_bindgen]
pub fn is_model_loaded() -> bool {
    MODEL.lock().map(|m| m.is_some()).unwrap_or(false)
}

/// Load the SmolLM2 model from provided weights and tokenizer data.
///
/// # Arguments
/// * `model_weights` - The model weights as a byte array (safetensors format)
/// * `tokenizer_json` - The tokenizer configuration as JSON string
/// * `config_json` - The model configuration as JSON string
#[wasm_bindgen]
pub async fn load_model(
    model_weights: &[u8],
    tokenizer_json: &str,
    config_json: &str,
) -> Result<(), JsValue> {
    console_log!("SmolLM2: Starting model load...");

    // Parse config
    let config: LlamaConfig = serde_json::from_str(config_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse config: {}", e)))?;

    let config = config.into_config(false);

    console_log!(
        "SmolLM2: Config loaded - vocab_size: {}, hidden_size: {}",
        config.vocab_size,
        config.hidden_size
    );

    // Initialize tokenizer
    let tokenizer = Tokenizer::from_bytes(tokenizer_json.as_bytes())
        .map_err(|e| JsValue::from_str(&format!("Failed to load tokenizer: {}", e)))?;

    console_log!("SmolLM2: Tokenizer loaded");

    // Use CPU device for WASM
    let device = Device::Cpu;

    // Load model weights using safetensors
    let tensors = candle_core::safetensors::load_buffer(model_weights, &device)
        .map_err(|e| JsValue::from_str(&format!("Failed to load weights: {}", e)))?;

    let vb = VarBuilder::from_tensors(tensors, candle_core::DType::F32, &device);

    // Build the model
    let model = Llama::load(vb, &config)
        .map_err(|e| JsValue::from_str(&format!("Failed to build model: {}", e)))?;

    console_log!("SmolLM2: Model built successfully");

    // Create KV cache for efficient generation
    let cache = Cache::new(true, candle_core::DType::F32, &config, &device)
        .map_err(|e| JsValue::from_str(&format!("Failed to create cache: {}", e)))?;

    // Store model in global state
    let smol_model = SmolLM2Model {
        model,
        tokenizer,
        _config: config,
        device,
        cache,
    };

    *MODEL
        .lock()
        .map_err(|e| JsValue::from_str(&format!("Lock error: {}", e)))? = Some(smol_model);

    console_log!("SmolLM2: Model ready for inference");
    Ok(())
}

/// Generate text from a prompt.
///
/// # Arguments
/// * `prompt` - The input prompt text
/// * `params_json` - Generation parameters as JSON (optional, uses defaults if empty)
/// * `callback` - JavaScript callback function called for each generated token
///
/// # Returns
/// The complete generated text
#[wasm_bindgen]
pub async fn generate(
    prompt: &str,
    params_json: &str,
    callback: js_sys::Function,
) -> Result<String, JsValue> {
    let params: GenerationParams = if params_json.is_empty() {
        GenerationParams::default()
    } else {
        serde_json::from_str(params_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid params: {}", e)))?
    };

    console_log!(
        "SmolLM2: Generating with max_tokens={}, temp={}",
        params.max_tokens,
        params.temperature
    );

    let mut model_guard = MODEL
        .lock()
        .map_err(|e| JsValue::from_str(&format!("Lock error: {}", e)))?;

    let model_wrapper = model_guard
        .as_mut()
        .ok_or_else(|| JsValue::from_str("Model not loaded"))?;

    // Tokenize the prompt
    let encoding = model_wrapper
        .tokenizer
        .encode(prompt, true)
        .map_err(|e| JsValue::from_str(&format!("Tokenization failed: {}", e)))?;

    let tokens: Vec<u32> = encoding.get_ids().to_vec();
    let prompt_len = tokens.len();

    console_log!("SmolLM2: Prompt tokenized to {} tokens", prompt_len);

    // Setup logits processor for sampling
    let mut logits_processor =
        LogitsProcessor::new(params.seed, Some(params.temperature), Some(params.top_p));

    let mut generated_text = String::new();
    let mut all_tokens = tokens.clone();

    // Get EOS token ID
    let eos_token_id = model_wrapper
        .tokenizer
        .token_to_id("</s>")
        .or_else(|| model_wrapper.tokenizer.token_to_id("<|endoftext|>"))
        .unwrap_or(2);

    // Generation loop
    for i in 0..params.max_tokens {
        let context_size = if i == 0 { tokens.len() } else { 1 };
        let start_pos = all_tokens.len().saturating_sub(context_size);

        let input_tokens = &all_tokens[start_pos..];
        let input_tensor = Tensor::new(input_tokens, &model_wrapper.device)
            .map_err(|e| JsValue::from_str(&format!("Failed to create input tensor: {}", e)))?;
        let input_tensor = input_tensor
            .unsqueeze(0)
            .map_err(|e| JsValue::from_str(&format!("Failed to unsqueeze: {}", e)))?;

        // Forward pass with cache
        let logits = model_wrapper
            .model
            .forward(&input_tensor, start_pos, &mut model_wrapper.cache)
            .map_err(|e| JsValue::from_str(&format!("Forward pass failed: {}", e)))?;

        // Get logits for next token prediction
        let logits = logits
            .squeeze(0)
            .map_err(|e| JsValue::from_str(&format!("Squeeze failed: {}", e)))?;

        let seq_len = logits
            .dim(0)
            .map_err(|e| JsValue::from_str(&format!("Failed to get dim: {}", e)))?;

        let logits = logits
            .get(seq_len - 1)
            .map_err(|e| JsValue::from_str(&format!("Get logits failed: {}", e)))?;

        // Apply repeat penalty
        let logits = if params.repeat_penalty != 1.0 {
            let start_at = all_tokens.len().saturating_sub(params.repeat_last_n);
            candle_transformers::utils::apply_repeat_penalty(
                &logits,
                params.repeat_penalty,
                &all_tokens[start_at..],
            )
            .map_err(|e| JsValue::from_str(&format!("Repeat penalty failed: {}", e)))?
        } else {
            logits
        };

        // Sample next token
        let next_token = logits_processor
            .sample(&logits)
            .map_err(|e| JsValue::from_str(&format!("Sampling failed: {}", e)))?;

        // Check for EOS
        if next_token == eos_token_id {
            console_log!("SmolLM2: EOS token reached");
            break;
        }

        all_tokens.push(next_token);

        // Decode the new token
        if let Ok(text) = model_wrapper.tokenizer.decode(&[next_token], false) {
            generated_text.push_str(&text);

            // Call the callback with the new token
            let this = JsValue::NULL;
            let token_js = JsValue::from_str(&text);
            let _ = callback.call1(&this, &token_js);
        }
    }

    console_log!(
        "SmolLM2: Generation complete, {} tokens generated",
        all_tokens.len() - prompt_len
    );

    Ok(generated_text)
}

/// Clear the loaded model from memory.
#[wasm_bindgen]
pub fn clear_model() -> Result<(), JsValue> {
    *MODEL
        .lock()
        .map_err(|e| JsValue::from_str(&format!("Lock error: {}", e)))? = None;
    console_log!("SmolLM2: Model cleared from memory");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_params() {
        let params = GenerationParams::default();
        assert_eq!(params.max_tokens, 256);
        assert!((params.temperature - 0.7).abs() < f64::EPSILON);
    }

    #[test]
    fn test_params_serialization() {
        let params = GenerationParams::default();
        let json = serde_json::to_string(&params).unwrap();
        let parsed: GenerationParams = serde_json::from_str(&json).unwrap();
        assert_eq!(params.max_tokens, parsed.max_tokens);
    }
}
