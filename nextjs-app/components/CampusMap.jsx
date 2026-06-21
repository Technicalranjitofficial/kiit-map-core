'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Map, { Marker, Popup, Source, Layer } from 'react-map-gl/maplibre';
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
      paint: { 'background-color': '#0f172a' }
    },
    {
      id: 'campus-greenspace',
      type: 'fill',
      source: 'campus-buildings',
      'source-layer': 'multipolygons',
      filter: ['any', ['==', ['get', 'leisure'], 'park'], ['==', ['get', 'landuse'], 'grass'], ['==', ['get', 'landuse'], 'meadow'], ['==', ['get', 'natural'], 'wood']],
      paint: { 'fill-color': '#064e3b', 'fill-opacity': 0.6 }
    },
    {
      id: 'campus-water',
      type: 'fill',
      source: 'campus-buildings',
      'source-layer': 'multipolygons',
      filter: ['==', ['get', 'natural'], 'water'],
      paint: { 'fill-color': '#0284c7', 'fill-opacity': 0.8 }
    },
    {
      id: 'campus-roads-layer',
      type: 'line',
      source: 'campus-roads',
      'source-layer': 'lines',
      filter: ['has', 'highway'],
      paint: {
        'line-color': '#334155',
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 10],
        'line-opacity': 0.8
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
          ['==', ['get', 'amenity'], 'college'], '#a855f7',
          '#1e293b'
        ],
        'fill-extrusion-height': ['*', 4, ['to-number', ['get', 'building:levels'], 3]],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.95
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
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1
      }
    },
    {
      id: 'campus-buildings-highlight',
      type: 'fill-extrusion',
      source: 'campus-buildings',
      'source-layer': 'multipolygons',
      filter: ['in', 'name', ''],
      paint: {
        'fill-extrusion-color': '#fcd34d',
        'fill-extrusion-height': ['*', 4, ['to-number', ['get', 'building:levels'], 3]],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 1.0
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
  const [hoverInfo, setHoverInfo] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [destination, setDestination] = useState(null);
  const [routeData, setRouteData] = useState(null);

  const onHover = useCallback(event => {
    const feature = event.features && event.features[0];
    if (feature && feature.properties && feature.properties.name) {
      setHoverInfo({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        name: feature.properties.name,
        type: feature.properties.building || feature.properties.amenity || 'Facility'
      });
    } else {
      setHoverInfo(null);
    }
  }, []);

  const onClick = useCallback(event => {
    const feature = event.features && event.features[0];
    if (feature && feature.properties && feature.properties.name) {
      setDestination({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        name: feature.properties.name,
      });
    }
  }, []);

  const structuralStyleInteractive = {
    ...structuralStyle,
    layers: structuralStyle.layers.map(layer => {
      if (layer.id === 'campus-buildings-highlight' && hoverInfo) {
        return {
          ...layer,
          filter: ['==', 'name', hoverInfo.name]
        };
      }
      return layer;
    })
  };

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
          setUserLocation({
            longitude: pos.coords.longitude,
            latitude: pos.coords.latitude
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

  useEffect(() => {
    if (!userLocation || !destination) return;

    const fetchRoute = async () => {
      try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/foot/${userLocation.longitude},${userLocation.latitude};${destination.longitude},${destination.latitude}?geometries=geojson&overview=full`);
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
          setRouteData({
            geometry: data.routes[0].geometry,
            distance: data.routes[0].distance,
            duration: data.routes[0].duration
          });
        }
      } catch (e) {
        console.error('Failed to fetch route', e);
      }
    };
    fetchRoute();
  }, [userLocation, destination]);

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
        mapStyle={structuralStyleInteractive}
        interactiveLayerIds={['campus-buildings-layer']}
        onMouseMove={onHover}
        onMouseLeave={() => setHoverInfo(null)}
        onClick={onClick}
      >
        {routeData && (
          <Source id="route-source" type="geojson" data={routeData.geometry}>
            <Layer
              id="route-layer"
              type="line"
              paint={{
                'line-color': '#10b981',
                'line-width': 6,
                'line-opacity': 0.8
              }}
            />
          </Source>
        )}
        {hoverInfo && (
          <Popup
            longitude={hoverInfo.longitude}
            latitude={hoverInfo.latitude}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={20}
          >
            <div style={{ padding: '10px', backgroundColor: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(10px)', color: 'white', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', minWidth: '150px' }}>
              <h3 style={{ margin: '0 0 5px 0', fontSize: '14px', fontWeight: 'bold' }}>{hoverInfo.name}</h3>
              <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8', textTransform: 'capitalize' }}>{hoverInfo.type}</p>
            </div>
          </Popup>
        )}
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
      {destination && routeData && (
        <div style={{ position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(10px)', color: 'white', padding: '15px 25px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', gap: '20px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', zIndex: 10 }}>
          <div>
            <h3 style={{ margin: '0 0 5px 0', fontSize: '16px' }}>Navigating to {destination.name}</h3>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '13px' }}>
              {(routeData.distance / 1000).toFixed(2)} km • {Math.ceil(routeData.duration / 60)} min walk
            </p>
          </div>
          <button 
            onClick={() => { setDestination(null); setRouteData(null); }}
            style={{ backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
