'use client';

import React, { useEffect, useState, useRef } from 'react';
import Map, { Marker } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { io } from 'socket.io-client';

import 'maplibre-gl/dist/maplibre-gl.css';

const structuralStyle = {
  version: 8,
  sources: {
    'campus-buildings': {
      type: 'vector',
      tiles: [`${process.env.NEXT_PUBLIC_TILE_URL}/multipolygons/{z}/{x}/{y}`],
      minzoom: 0,
      maxzoom: 22
    },
    'campus-roads': {
      type: 'vector',
      tiles: [`${process.env.NEXT_PUBLIC_TILE_URL}/lines/{z}/{x}/{y}`],
      minzoom: 0,
      maxzoom: 22
    }
  },
  layers: [
    {
      id: 'background-base',
      type: 'background',
      paint: { 'background-color': '#eae8e4' }
    },
    {
      id: 'campus-roads-layer',
      type: 'line',
      source: 'campus-roads',
      'source-layer': 'lines',
      filter: ['has', 'highway'],
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 8]
      }
    },
    {
      id: 'campus-buildings-layer',
      type: 'fill-extrusion',
      source: 'campus-buildings',
      'source-layer': 'multipolygons',
      filter: ['has', 'building'],
      paint: {
        'fill-extrusion-color': [
          'case',
          ['==', ['get', 'building'], 'dormitory'], '#3b82f6',
          ['==', ['get', 'building'], 'university'], '#a855f7',
          ['==', ['get', 'amenity'], 'university'], '#a855f7',
          '#d1cdc7'
        ],
        'fill-extrusion-height': 15,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.9
      }
    },
    {
      id: 'campus-building-labels',
      type: 'symbol',
      source: 'campus-buildings',
      'source-layer': 'multipolygons',
      filter: ['has', 'name'],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-anchor': 'center',
        'text-justify': 'center'
      },
      paint: {
        'text-color': '#1f2937',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2
      }
    }
  ]
};

export default function CampusMap() {
  const [viewport, setViewport] = useState({
    latitude: 20.3538,
    longitude: 85.8165,
    zoom: 15
  });

  const [liveNodes, setLiveNodes] = useState({});
  const socketRef = useRef(null);
  const [webGLSupported, setWebGLSupported] = useState(true);

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const supported = !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
      if (!supported) {
        setWebGLSupported(false);
        return;
      }
    } catch (e) {
      setWebGLSupported(false);
      return;
    }

    socketRef.current = io(process.env.NEXT_PUBLIC_WS_URL, {
      transports: ['websocket']
    });

    socketRef.current.on('node-updated', (node) => {
      if (!node.position) return;
      setLiveNodes((prev) => ({ ...prev, [node.id]: node }));
    });

    socketRef.current.on('node-dropped', (id) => {
      setLiveNodes((prev) => {
        const mutations = { ...prev };
        delete mutations[id];
        return mutations;
      });
    });

    if (navigator.geolocation) {
      const observerId = navigator.geolocation.watchPosition(
        (pos) => {
          socketRef.current.emit('push-telemetry', {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            heading: pos.coords.heading
          });
        },
        (err) => console.error(`GPS Error: ${err.message}`),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );

      return () => {
        navigator.geolocation.clearWatch(observerId);
        socketRef.current.disconnect();
      };
    }
  }, []);

  if (!webGLSupported) {
    return (
      <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e1e1e', color: 'white', padding: '20px', textAlign: 'center' }}>
        <h2>⚠️ WebGL is Disabled</h2>
        <p style={{ marginTop: '10px', maxWidth: '400px', lineHeight: '1.5' }}>
          Your browser is currently blocking Hardware Acceleration (WebGL), which is required to render the map graphics. 
          <br /><br />
          Please enable <b>Hardware Acceleration</b> in your browser settings, or try opening this link on your smartphone.
        </p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <Map
        {...viewport}
        onMove={evt => setViewport(evt.viewState)}
        mapLib={maplibregl}
        mapStyle={structuralStyle}
      >
        {Object.values(liveNodes).map((node) => (
          <Marker
            key={node.id}
            latitude={node.position.lat}
            longitude={node.position.lng}
          >
            <div className={`custom-node-pin ${node.role}`} style={{ transform: `rotate(${node.position.bearing}deg)` }}>
              📍 <span style={{ fontSize: '10px', display: 'block' }}>{node.label}</span>
            </div>
          </Marker>
        ))}
      </Map>
    </div>
  );
}
