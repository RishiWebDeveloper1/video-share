import './App.css'
import { BrowserRouter, Route, Routes } from "react-router-dom"
import Call from './pages/Call';
import Home from './pages/Home';

function App() {

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route index element={<Home />} />
          <Route path="call/:type/:roomId" element={<Call />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App;
