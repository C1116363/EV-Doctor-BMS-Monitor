import { useState, useEffect } from 'react';
import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';

export default function useBluetooth() {
    const [enabled, setEnabled] = useState<boolean>(false);
    const [pairedDevices, setPairedDevices] = useState<BluetoothDevice[]>([]);
    const [connectedDevice, setConnectedDevice] = useState<BluetoothDevice | null>(null);

    useEffect(() => {
        const checkBluetooth = async () => {
            try {
                const isEnabled = await RNBluetoothClassic.isBluetoothEnabled();
                setEnabled(isEnabled);
            } catch (error) {
                console.error("Error checking Bluetooth:", error);
            }
        };

        checkBluetooth();
        fetchPairedDevices();
    }, []);

    const fetchPairedDevices = async () => {
        if (!enabled) return;
        try {
            const devices = await RNBluetoothClassic.getBondedDevices();
            setPairedDevices(devices);
        } catch (error) {
            console.error("Error fetching devices:", error);
        }
    };

    return { enabled, pairedDevices, connectedDevice, setConnectedDevice, fetchPairedDevices };
}
