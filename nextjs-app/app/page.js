import dynamic from 'next/dynamic';

const CampusMap = dynamic(() => import('../components/CampusMap'), { 
  ssr: false,
  loading: () => <div style={{ width: '100%', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>Loading Map...</div>
});

export default function Home() {
  return (
    <main style={{ width: '100%', height: '100vh' }}>
      <CampusMap />
    </main>
  );
}
