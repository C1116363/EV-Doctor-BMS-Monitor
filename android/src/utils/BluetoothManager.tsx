import { PermissionsAndroid, Alert } from 'react-native';
import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';

export const requestLocationPermission = async () => {
    try {
        const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
        console.error("Error requesting permission:", error);
        return false;
    }
};

export const getPairedDevices = async () => {
    try {
        const granted = await requestLocationPermission();
        if (!granted) return [];
        return await RNBluetoothClassic.getBondedDevices();
    } catch (error) {
        console.error("Error getting paired devices:", error);
        return [];
    }
};

export const connectWithDevice = async (device: BluetoothDevice, setConnectedDevice: any, setPairingDevice: any) => {
    setPairingDevice(device.address);
    try {
        let connected = await device.connect();
        if (connected) {
            setConnectedDevice(device);
            console.log(`Connected to ${device.name}`);
        }
    } catch (error) {
        console.error("Error connecting:", error);
    } finally {
        setPairingDevice(null);
    }
};

export const sendCommandToSerial = async (command: string, connectedDevice: BluetoothDevice | null) => {
    if (!connectedDevice) {
        Alert.alert("No Device Connected", "Please pair and connect a device first.");
        return;
    }
    try {
        const success = await connectedDevice.write(command + "\n", "utf-8");
        if (success) {
            Alert.alert("Command Sent", `Sent "${command}" to ${connectedDevice.name}`);
        } else {
            Alert.alert("Send Failed", "Failed to send data.");
        }
    } catch (error) {
        Alert.alert("Error", "Could not send data.");
    }
};
