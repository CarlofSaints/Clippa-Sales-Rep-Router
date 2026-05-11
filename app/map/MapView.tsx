"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Store, Rep, Channel } from "@/lib/types";

interface Props {
  stores: Store[];
  repMap: Map<string, Rep>;
  channelMap: Map<string, Channel>;
  repColors: Record<string, string>;
}

export default function MapView({ stores, repMap, channelMap, repColors }: Props) {
  // Center on Gauteng
  const center: [number, number] = [-26.2, 28.05];
  const zoom = 10;

  const fmt = (n: number) =>
    "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {stores.map((store) => {
        const lat = parseFloat(store.gpsLat);
        const lng = parseFloat(store.gpsLng);
        if (isNaN(lat) || isNaN(lng)) return null;

        const color = repColors[store.repCode] || "#6B7280";
        const rep = repMap.get(store.repCode);
        const ch = channelMap.get(store.channelId);

        return (
          <CircleMarker
            key={store.id}
            center={[lat, lng]}
            radius={5}
            pathOptions={{
              fillColor: color,
              color: color,
              weight: 1,
              opacity: 0.8,
              fillOpacity: 0.6,
            }}
          >
            <Popup>
              <div className="text-xs space-y-1">
                <p className="font-bold text-sm">{store.name}</p>
                <p><span className="text-gray-500">Channel:</span> {ch?.name || store.channelId}</p>
                <p><span className="text-gray-500">Rep:</span> {rep?.name || store.repCode}</p>
                <p><span className="text-gray-500">Sales:</span> {fmt(store.monthlySales)}</p>
                <p><span className="text-gray-500">ID:</span> {store.placeId}</p>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
