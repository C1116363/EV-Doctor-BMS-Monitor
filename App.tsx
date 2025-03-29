import React, { useState, useEffect } from 'react';
import { 
    View, Text, PermissionsAndroid, TouchableOpacity, FlatList, Alert, StyleSheet 
} from 'react-native';
import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';

const App: React.FC = () => {
    const [enabled, setEnabled] = useState<boolean>(false);
    const [pairedDevices, setPairedDevices] = useState<BluetoothDevice[]>([]);
    const [pairingDevice, setPairingDevice] = useState<string | null>(null);
    const [connectedDevice, setConnectedDevice] = useState<BluetoothDevice | null>(null);

    useEffect(() => {
        const checkBluetooth = async () => {
            try {
                const isEnabled = await RNBluetoothClassic.isBluetoothEnabled();
                setEnabled(isEnabled);
            } catch (error) {
                console.error("Error checking Bluetooth status:", error);
            }
        };
        checkBluetooth();
        getPairedDevices();
    }, []);

    const requestLocationPermission = async () => {
        try {
            const granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                {
                    title: 'Location Permission Required',
                    message: 'Location is needed for Bluetooth device discovery.',
                    buttonNeutral: 'Ask Me Later',
                    buttonNegative: 'Cancel',
                    buttonPositive: 'OK'
                }
            );
            return granted === PermissionsAndroid.RESULTS.GRANTED;
        } catch (error) {
            console.error("Error requesting permission:", error);
            return false;
        }
    };

    const connectWithDevice = async (device: BluetoothDevice) => {
        setPairingDevice(String(device.address));
        console.log(`Attempting to connect: ${device.address}`);
        
        try {
            let alreadyConnected = await device.isConnected();
            let connected = alreadyConnected || await device.connect();

            if (connected) {
                setConnectedDevice(device);
                console.log(`Connected to ${device.name}`);
            }
        } catch (error) {
            console.error("Connection failed:", error);
            Alert.alert("Connection Failed", "Could not connect to device.");
        }

        setPairingDevice(null);
    };

    const sendCommandToSerial = async (command: string) => {
        if (!connectedDevice) {
            Alert.alert("No Device Connected", "Please connect a device first.");
            return;
        }

        try {
            const success = await connectedDevice.write(command + "\n", "utf-8");
            if (success) {
                console.log(`Sent: ${command}`);
                Alert.alert("Command Sent", `Sent "${command}" to ${connectedDevice.name}`);
            } else {
                Alert.alert("Send Failed", "Failed to send data.");
            }
        } catch (error) {
            console.error("Error sending data:", error);
            Alert.alert("Error", "Could not send data.");
        }
    };

    const getPairedDevices = async () => {
        try {
            const bleEnabled = await RNBluetoothClassic.isBluetoothEnabled();
            if (!bleEnabled) {
                const success = await RNBluetoothClassic.requestBluetoothEnabled();
                if (!success) {
                    Alert.alert("Bluetooth Required", "Please enable Bluetooth.");
                    return;
                }
            }

            const permissionGranted = await requestLocationPermission();
            if (!permissionGranted) return;

            const devices = await RNBluetoothClassic.getBondedDevices();
            setPairedDevices(devices);
        } catch (err) {
            console.error("Error fetching paired devices:", err);
        }
    };

    return (
        <View style={styles.container}>
            {/* 🔹 Show Bluetooth status at the top left */}
            {connectedDevice && (
                <Text style={styles.bleStatus}>
                    🔵 Bluetooth Connected: {connectedDevice.name || "Unknown Device"}
                </Text>
            )}

            {connectedDevice ? (
                // 🔹 Show command buttons after connection
                <View style={styles.commandContainer}>
                    <Text style={styles.commandTitle}>Send Commands</Text>

                    <View style={styles.commandButtons}>
                        <TouchableOpacity 
                            onPress={() => sendCommandToSerial("command1")} 
                            style={[styles.commandButton, { backgroundColor: 'green' }]}
                        >
                            <Text style={styles.commandText}>Eng RPM</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            onPress={() => sendCommandToSerial("command2")} 
                            style={[styles.commandButton, { backgroundColor: 'red' }]}
                        >
                            <Text style={styles.commandText}>Speed</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            onPress={() => sendCommandToSerial("command3")} 
                            style={[styles.commandButton, { backgroundColor: 'blue' }]}
                        >
                            <Text style={styles.commandText}>Batt. V</Text>
                        </TouchableOpacity>
                    </View>

                    {/* 🔹 Show Bluetooth connection status below command buttons */}
                    <Text style={styles.bleConnectedText}>
                        🔵 Connected to: {connectedDevice.name || "Unknown Device"}
                    </Text>
                </View>
            ) : (
                // 🔹 Show Bluetooth pairing UI if no device is connected
                <View style={styles.bluetoothContainer}>
                    <Text style={styles.header}>OBD2 Bluetooth Adapter</Text>

                    <TouchableOpacity 
                        onPress={getPairedDevices} 
                        style={styles.reloadButton}
                    >
                        <Text style={styles.reloadText}>Reload Paired Devices</Text>
                    </TouchableOpacity>

                    <FlatList
                        data={pairedDevices}
                        keyExtractor={(item) => item.address}
                        renderItem={({ item }) => (
                            <TouchableOpacity 
                                onPress={() => connectWithDevice(item)} 
                                style={[
                                    styles.deviceButton, 
                                    pairingDevice === item.address && styles.connecting
                                ]}
                                disabled={pairingDevice === item.address}
                            >
                                <Text style={styles.deviceName}>{item.name || "Unknown Device"}</Text>
                                <Text style={styles.deviceAddress}>{item.address}</Text>
                                {pairingDevice === item.address && <Text style={styles.connectingText}>Connecting...</Text>}
                            </TouchableOpacity>
                        )}
                    />
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1, 
        padding: 20, 
        alignItems: 'center', 
        justifyContent: 'center'
    },
    bluetoothContainer: {
        alignItems: 'center',
        justifyContent: 'center'
    },
    header: {
        fontSize: 20, 
        fontWeight: 'bold', 
        textAlign: 'center',
        marginBottom: 10
    },
    reloadButton: {
        backgroundColor: 'blue', 
        padding: 10, 
        borderRadius: 5, 
        marginBottom: 10
    },
    reloadText: {
        color: 'white', 
        fontSize: 16
    },
    deviceButton: {
        padding: 10,
        marginVertical: 5,
        borderRadius: 5,
        backgroundColor: "#ddd"
    },
    connecting: {
        backgroundColor: "gray"
    },
    deviceName: {
        fontSize: 16
    },
    deviceAddress: {
        fontSize: 14, 
        color: 'gray'
    },
    connectingText: {
        fontSize: 14, 
        color: 'blue'
    },
    commandContainer: {
        alignItems: 'center',
        justifyContent: 'center'
    },
    bleStatus: {
        fontSize: 16, 
        fontWeight: 'bold', 
        color: 'green', 
        position: 'absolute', 
        top: 10, 
        left: 10
    },
    bleConnectedText: {
        fontSize: 16, 
        fontWeight: 'bold', 
        color: 'green', 
        marginTop: 20
    },
    commandTitle: {
        fontSize: 20, 
        fontWeight: 'bold', 
        marginBottom: 20
    }
});

export default App;
