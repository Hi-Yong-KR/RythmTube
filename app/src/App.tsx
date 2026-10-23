import { Route, Routes } from 'react-router-dom'
import SongSelect from './pages/SongSelect'
import Play from './pages/Play'
import Result from './pages/Result'
import Shop from './pages/Shop'
import { PaymentFail, PaymentSuccess } from './pages/Payment'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SongSelect />} />
      <Route path="/play" element={<Play />} />
      <Route path="/result" element={<Result />} />
      <Route path="/shop" element={<Shop />} />
      <Route path="/payment/success" element={<PaymentSuccess />} />
      <Route path="/payment/fail" element={<PaymentFail />} />
    </Routes>
  )
}
