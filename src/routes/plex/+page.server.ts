import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// In a real scenario, we would fetch from Plex API here.
	// For the mockup, we return static data.
	return {
		server: {
			name: "logueos-media-01",
			address: "10.0.0.50",
			version: "1.40.1.8227",
			uptime: "14d 6h 22m",
			status: "online"
		},
		stats: [
			{ id: 'streams', label: "Active Streams", value: "3", icon: "Activity", trend: "up" },
			{ id: 'movies', label: "Total Movies", value: "1,242", icon: "Film" },
			{ id: 'tv', label: "TV Shows", value: "156", icon: "Tv" },
			{ id: 'music', label: "Total Music", value: "48,201", icon: "Music" }
		],
		activeStreams: [
			{ 
				id: 1,
				user: "dreighto", 
				content: "Dune: Part Two", 
				progress: 65, 
				quality: "4K HDR", 
				transcode: "Direct Play",
				device: "LG TV"
			},
			{ 
				id: 2,
				user: "guest_alpha", 
				content: "The Bear - S03E01", 
				progress: 12, 
				quality: "1080p", 
				transcode: "Transcoding (1080p -> 720p)",
				device: "iPad"
			},
			{ 
				id: 3,
				user: "family_room", 
				content: "Bluey - S01E05", 
				progress: 88, 
				quality: "1080p", 
				transcode: "Direct Stream",
				device: "Apple TV"
			}
		],
		system: {
			cpu: 24,
			memory: 42,
			storage: 78
		},
		recent: [
			{ id: 'r1', type: "added", content: "Furiosa: A Mad Max Saga", time: "2h ago" },
			{ id: 'r2', type: "watched", user: "dreighto", content: "Kingdom of the Planet of the Apes", time: "5h ago" },
			{ id: 'r3', type: "added", content: "The Boys - S04E04", time: "8h ago" },
			{ id: 'r4', type: "added", content: "House of the Dragon - S02E01", time: "1d ago" }
		]
	};
};
