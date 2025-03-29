import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';

const BluetoothService = {
    async getPairedDevices(): Promise<BluetoothDevice[]> {
        try {
            return await RNBluetoothClassic.getBondedDevices();
        } catch (error) {
            console.error("Error fetching paired devices:", error);
            return [];
        }
    },

    async connectDevice(device: BluetoothDevice): Promise<boolean> {
        try {
            let isConnected = await device.isConnected();
            if (!isConnected) {
                isConnected = await device.connect();
            }
            return isConnected;
        } catch (error) {
            console.error("Connection failed:", error);
            return false;
        }
    }
};

export default BluetoothService;
