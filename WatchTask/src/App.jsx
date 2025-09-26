import { BrowserRouter, Routes, Route } from "react-router";
import Header from "@/Layout/Header";
import Footer from "@/Layout/Footer";
import { PeerProvider } from "@/p2p/PeerContext";
import PeerDebugPanel from "@/p2p/PeerDebugPanel";
function App() {
  return (
    <BrowserRouter>
      <PeerProvider>
        <div className="min-h-dvh flex flex-col">
          <Header />
          <main className="flex-grow bg-gray-50 pt-12">
            <PeerDebugPanel />
          </main>
          <Footer />
        </div>
      </PeerProvider>
    </BrowserRouter>
  );
}

export default App;
