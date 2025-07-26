const CACHE_NAME = 'booktracker-v2.1';
const STATIC_CACHE = 'booktracker-static-v2.1';
const EXTERNAL_CACHE = 'booktracker-external-v2.1';

const staticAssets = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png'
];

const externalLibraries = [
    'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js',
    'https://unpkg.com/@zxing/library@latest/umd/index.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'
];

// Install service worker
self.addEventListener('install', event => {
    console.log('SW: Installing...');
    event.waitUntil(
        Promise.all([
            // Cache static assets (critical)
            caches.open(STATIC_CACHE).then(cache => {
                console.log('SW: Caching static assets');
                return cache.addAll(staticAssets);
            }),
            // Cache external libraries (best effort)
            caches.open(EXTERNAL_CACHE).then(cache => {
                console.log('SW: Attempting to cache external libraries');
                return Promise.allSettled(
                    externalLibraries.map(url =>
                        fetch(url, { mode: 'cors' })
                            .then(response => {
                                if (response.ok) {
                                    return cache.put(url, response);
                                }
                                throw new Error(`Failed to fetch ${url}: ${response.status}`);
                            })
                            .catch(err => {
                                console.log('SW: Failed to cache external library:', url, err.message);
                            })
                    )
                );
            })
        ]).then(() => {
            console.log('SW: Installation completed');
        }).catch(error => {
            console.error('SW: Installation failed:', error);
            throw error;
        })
    );
    self.skipWaiting();
});

// Fetch event
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip caching for API calls and non-GET requests
    if (url.hostname.includes('googleapis.com') ||
        url.hostname.includes('openlibrary.org') ||
        url.hostname.includes('isbn.cloud') ||
        url.hostname.includes('worldcat.org') ||
        request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    console.log('SW: Serving from cache:', request.url);
                    return cachedResponse;
                }
                
                // Try to fetch from network
                return fetch(request)
                    .then(networkResponse => {
                        // Don't cache invalid responses
                        if (!networkResponse || networkResponse.status !== 200) {
                            return networkResponse;
                        }
                        
                        // Determine which cache to use
                        const cacheToUse = externalLibraries.some(lib => request.url === lib || request.url.includes(new URL(lib).pathname)) 
    ? EXTERNAL_CACHE 
    : STATIC_CACHE;
                        
                        // Clone and cache the response
                        const responseToCache = networkResponse.clone();
                        caches.open(cacheToUse)
                            .then(cache => cache.put(request, responseToCache))
                            .catch(err => console.log('SW: Failed to cache:', err));
                        
                        return networkResponse;
                    })
                    .catch(error => {
                        console.error('SW: Fetch failed:', error);
                        
                        // For navigation requests, try to return cached index.html
                        if (request.mode === 'navigate') {
                            return caches.match('/index.html')
                                .then(fallback => {
                                    if (fallback) {
                                        return fallback;
                                    }
                                    return new Response('Offline and no cached content available', {
                                        status: 503,
                                        statusText: 'Service Unavailable'
                                    });
                                });
                        }
                        
                        throw error;
                    });
            })
    );
});

// Activate service worker
self.addEventListener('activate', event => {
    console.log('SW: Activating...');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (![STATIC_CACHE, EXTERNAL_CACHE].includes(cacheName)) {
                            console.log('SW: Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('SW: Activation completed');
            })
            .catch(error => {
                console.error('SW: Activation failed:', error);
            })
    );
    self.clients.claim();
});

// Handle messages from main thread
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
