import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-node for Docker deployment
		adapter: adapter({
			// Default port is 3000
			out: 'build'
		})
	}
};

export default config;
