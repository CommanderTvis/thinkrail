/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** `tab` for a Playground-only build with no host to reach, such as the GitHub Pages deploy. */
	readonly VITE_HOST_MODE?: string;
}
