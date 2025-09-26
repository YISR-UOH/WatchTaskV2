import { BrowserRouter, Routes, Route } from "react-router";
import Header from "@/Layout/Header";
import Footer from "@/Layout/Footer";
import PeerManager from "@/p2p/PeerManager";
function App() {
  return (
    <BrowserRouter>
      <div className="min-h-dvh flex flex-col">
        <Header />
        <main className="flex-grow bg-gray-50 pt-12">
          <PeerManager />
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default App;
