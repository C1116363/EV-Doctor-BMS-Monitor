import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';

const BluetoothManager = {
    getConnectedDevice: async (): Promise<BluetoothDevice | null> => {
        try {
            const devices = await RNBluetoothClassic.getConnectedDevices();
            return devices.length > 0 ? devices[0] : null;
        } catch (error) {
            console.error("Error checking connected devices:", error);
            return null;
        }
    },

    sendCommand: async (command: string): Promise<boolean> => {
        const device = await BluetoothManager.getConnectedDevice();
        if (!device) return false;

        try {
            await device.write(command + "\n", "utf-8");
            console.log(`Sent: ${command}`);
            return true;
        } catch (error) {
            console.error("Error sending command:", error);
            return false;
        }
    }
};

export default BluetoothManager;

