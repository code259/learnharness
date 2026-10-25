/**
 * The exercise catalog (fork #11 — docs/exercises-progress.md): a STARTING
 * POINT of well-known external practice, never a closed list. The teacher
 * searches it (find_exercises) and suggests items inside teaching chats
 * (suggest_exercise); when nothing here fits, it finds exercises anywhere
 * through research. Every URL was checked to resolve (2026-10-24).
 *
 * Pure data + search; browser-safe.
 */
import { tokens } from "./library.ts";

export interface CatalogExercise {
	id: string;
	title: string;
	/** The track it belongs to ("ARENA", "CS336", …). */
	source: string;
	url: string;
	/** Search words beyond the title. */
	topics: string;
}

const ARENA_REPO = "https://github.com/callummcdougall/ARENA_3.0/tree/main";
const arena = (chapter: string, part: string, title: string, topics: string): CatalogExercise => ({
	id: `arena-${part.replace(/_/g, "-")}`,
	title: `ARENA: ${title}`,
	source: "ARENA",
	url: `${ARENA_REPO}/${chapter}/exercises/${part}`,
	topics,
});
const cs336 = (repo: string, title: string, topics: string): CatalogExercise => ({
	id: `cs336-${repo}`,
	title: `CS336: ${title}`,
	source: "Stanford CS336",
	url: `https://github.com/stanford-cs336/${repo}`,
	topics,
});
const ZTH = "https://karpathy.ai/zero-to-hero.html";
const zth = (n: number, title: string, topics: string): CatalogExercise => ({
	id: `zero-to-hero-${n}`,
	title: `Zero to Hero ${n}: ${title}`,
	source: "Karpathy: Neural Networks Zero to Hero",
	url: ZTH,
	topics,
});

export const EXERCISE_CATALOG: readonly CatalogExercise[] = [
	{ id: "deep-ml", title: "Deep-ML problems", source: "Deep-ML", url: "https://www.deep-ml.com/problems", topics: "machine learning coding problems linear algebra numpy implement from scratch deep learning statistics" },
	{ id: "staffml", title: "StaffML practice", source: "StaffML (ML Systems)", url: "https://mlsysbook.ai/staffml/practice/", topics: "ml systems interview distributed training inference serving hardware memory throughput latency" },

	arena("chapter0_fundamentals", "part0_prereqs", "Prerequisites (einops, tensors)", "einops tensor manipulation pytorch basics"),
	arena("chapter0_fundamentals", "part1_ray_tracing", "Ray tracing (batched tensor ops)", "batched tensor operations broadcasting"),
	arena("chapter0_fundamentals", "part2_cnns", "CNNs and ResNets from scratch", "convolution resnet modules pytorch"),
	arena("chapter0_fundamentals", "part3_optimization", "Optimization (SGD, Adam, schedules)", "optimizer sgd adam momentum learning rate weights and biases"),
	arena("chapter0_fundamentals", "part4_backprop", "Backpropagation from scratch", "autograd backprop computational graph gradients"),
	arena("chapter0_fundamentals", "part51_vaes", "VAEs", "variational autoencoder latent generative"),
	arena("chapter0_fundamentals", "part52_gans", "GANs", "generative adversarial network"),
	arena("chapter1_transformer_interp", "part1_transformer_from_scratch", "Transformer from scratch", "transformer attention residual stream gpt2 implement"),
	arena("chapter1_transformer_interp", "part2_intro_to_mech_interp", "Intro to mechanistic interpretability", "transformerlens induction heads attention patterns circuits"),
	arena("chapter1_transformer_interp", "part31_linear_probes", "Linear probes", "probing representations linear probe"),
	arena("chapter1_transformer_interp", "part32_function_vectors_and_model_steering", "Function vectors and model steering", "steering activation addition function vectors"),
	arena("chapter1_transformer_interp", "part33_interp_with_saes", "Interpretability with SAEs", "sparse autoencoders features dictionary learning"),
	arena("chapter1_transformer_interp", "part34_activation_oracles", "Activation oracles", "activation oracles interpretability"),
	arena("chapter1_transformer_interp", "part41_indirect_object_identification", "Indirect object identification", "ioi circuit activation patching path patching"),
	arena("chapter1_transformer_interp", "part42_sae_circuits", "SAE circuits", "sparse autoencoder circuits transcoders attribution"),
	arena("chapter1_transformer_interp", "part51_balanced_bracket_classifier", "Balanced bracket classifier", "algorithmic interpretability circuits"),
	arena("chapter1_transformer_interp", "part52_grokking_and_modular_arithmetic", "Grokking and modular arithmetic", "grokking modular addition fourier generalization"),
	arena("chapter1_transformer_interp", "part53_othellogpt", "OthelloGPT", "world model linear representation probing"),
	arena("chapter1_transformer_interp", "part54_toy_models_of_superposition_and_saes", "Toy models of superposition and SAEs", "superposition polysemanticity toy models sparse autoencoders"),
	arena("chapter2_rl", "part1_intro_to_rl", "Intro to RL", "reinforcement learning bandits mdp value iteration"),
	arena("chapter2_rl", "part21_dqn", "DQN", "deep q learning replay buffer"),
	arena("chapter2_rl", "part22_vpg", "Vanilla policy gradient", "policy gradient reinforce"),
	arena("chapter2_rl", "part3_ppo", "PPO", "proximal policy optimization advantage clipping"),
	arena("chapter2_rl", "part4_rlhf", "RLHF", "reward model kl penalty rlhf language models"),
	arena("chapter2_rl", "part42_rlvr", "RL with verifiable rewards", "rlvr verifiable rewards reasoning grpo"),
	arena("chapter2_rl", "part43_rlaif", "RLAIF", "ai feedback constitutional preference"),
	arena("chapter2_rl", "part5_mcts_alphazero", "MCTS and AlphaZero", "monte carlo tree search self play"),
	arena("chapter3_llm_evals", "part1_intro_to_evals", "Intro to evals", "evaluations threat models benchmarks"),
	arena("chapter3_llm_evals", "part2_dataset_generation", "Eval dataset generation", "llm generated eval datasets"),
	arena("chapter3_llm_evals", "part3_running_evals_with_inspect", "Running evals with Inspect", "inspect eval framework"),
	arena("chapter3_llm_evals", "part4_llm_agents", "LLM agents", "agents tool use scaffolding"),
	arena("chapter3_llm_evals", "part5_ai_control", "AI control", "control protocols monitoring untrusted models"),
	arena("chapter4_alignment_science", "part1_emergent_misalignment", "Emergent misalignment", "emergent misalignment fine tuning narrow broad"),
	arena("chapter4_alignment_science", "part2_science_of_misalignment", "Science of misalignment", "model organisms misalignment alignment faking scheming"),
	arena("chapter4_alignment_science", "part3_interpreting_reasoning_models", "Interpreting reasoning models", "chain of thought reasoning models faithfulness"),
	arena("chapter4_alignment_science", "part4_persona_vectors", "Persona vectors", "persona vectors character traits steering"),
	arena("chapter4_alignment_science", "part5_investigator_agents", "Investigator agents", "auditing agents automated investigation"),

	cs336("assignment1-basics", "Basics (tokenizer, transformer LM, training loop)", "bpe tokenizer transformer language model adamw training from scratch"),
	cs336("assignment2-systems", "Systems (profiling, FlashAttention, distributed)", "profiling flashattention triton kernels distributed data parallel"),
	cs336("assignment3-scaling", "Scaling laws", "scaling laws compute optimal chinchilla"),
	cs336("assignment4-data", "Data (filtering, dedup, quality)", "pretraining data filtering deduplication quality classifiers"),
	cs336("assignment5-alignment", "Alignment (SFT, RL for reasoning)", "supervised fine tuning grpo expert iteration reasoning alignment"),

	zth(1, "micrograd: backprop from scratch", "autograd backpropagation neural network scalar"),
	zth(2, "makemore: bigram language model", "bigram language model counts negative log likelihood"),
	zth(3, "makemore: MLP", "multilayer perceptron embeddings language model"),
	zth(4, "makemore: activations, gradients, BatchNorm", "initialization batchnorm activation statistics"),
	zth(5, "makemore: becoming a backprop ninja", "manual backpropagation gradients"),
	zth(6, "makemore: WaveNet", "hierarchical convolutional language model"),
	zth(7, "Let's build GPT", "transformer self attention gpt from scratch"),
	zth(8, "Let's build the GPT tokenizer", "bpe tokenizer byte pair encoding"),
	zth(9, "Let's reproduce GPT-2 (124M)", "gpt2 pretraining reproduction training efficiency"),

	{ id: "tensor-puzzles", title: "Tensor Puzzles", source: "Sasha Rush", url: "https://github.com/srush/Tensor-Puzzles", topics: "broadcasting tensor operations pytorch numpy" },
	{ id: "gpu-puzzles", title: "GPU Puzzles", source: "Sasha Rush", url: "https://github.com/srush/GPU-Puzzles", topics: "cuda gpu kernels parallel programming numba" },
	{ id: "autodiff-puzzles", title: "Autodiff Puzzles", source: "Sasha Rush", url: "https://github.com/srush/Autodiff-Puzzles", topics: "derivatives jacobians automatic differentiation" },
	{ id: "leetgpu", title: "LeetGPU", source: "LeetGPU", url: "https://leetgpu.com", topics: "cuda gpu programming kernels challenges" },
];

/** Catalog items ranked by word overlap with the query (title counts
 *  double); zero-overlap items never match. */
export function searchCatalog(query: string, max = 6): CatalogExercise[] {
	const want = tokens(query);
	if (want.size === 0) return [];
	return EXERCISE_CATALOG.map((item, i) => {
		const title = tokens(item.title);
		const topics = tokens(item.topics);
		let score = 0;
		for (const w of want) score += (title.has(w) ? 2 : 0) + (topics.has(w) ? 1 : 0);
		return { item, i, score };
	})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.slice(0, max)
		.map((x) => x.item);
}
