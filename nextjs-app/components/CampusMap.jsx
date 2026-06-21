'use client';

import React, { useEffect, useState, useRef } from 'react';
import Map, { Marker } from 'react-map-gl';
import maplibregl from 'maplibre-gl';
import { io } from 'socket.io-client';

import 'maplibre-gl/dist/maplibre-gl.css';

const structuralStyle = {
  version: 8,
  sources: {
    'campus-vector-tiles': {
      type: 'vector',
      tiles: [`${process.env.NEXT_PUBLIC_TILE_URL}/index/{z}/{x}/{y}.pbf`],
      minzoom: 0,
      maxzoom: 18
    }
  },
  layers: [
    {
      id: 'background-base',
      type: 'background',
      paint: { 'background-color': '#eae8e4' }
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

  useEffect(() => {
    socketRef.current = io(process.env.NEXT_PUBLIC_WS_URL);

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
