export function getCurrentWebview() {
	return {
		setZoom: async (zoom: number) => {
			document.documentElement.style.zoom = String(zoom);
		},
	};
}
