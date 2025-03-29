import React, { useState, useEffect } from 'react';
import { 
    View, Text, TouchableOpacity, Alert, StyleSheet 
} from 'react-native';
import BluetoothManager from '../components/BluetoothManager';

const BluetoothScreen: React.FC = () => {
    const [connectedDevice, setConnectedDevice] = useState<any>(null);

    useEffect(() => {
        const fetchConnectedDevice = async () => {
            const device = await BluetoothManager.getConnectedDevice();
            if (device) setConnectedDevice(device);
        };
        fetchConnectedDevice();
    }, []);

    const sendCommand = async (command: string) => {
        if (!connectedDevice) {
            Alert.alert("No Device Connected", "Please connect a device first.");
            return;
        }

        const success = await BluetoothManager.sendCommand(command);
        if (success) {
            Alert.alert("Command Sent", `Sent "${command}" to ${connectedDevice.name}`);
        } else {
            Alert.alert("Error", "Could not send command.");
        }
    };

    return (
        <View style={styles.container}>
            {connectedDevice && (
                <Text style={styles.deviceName}>
                    🔵 Connected: {connectedDevice.name || "Unknown Device"}
                </Text>
            )}

            <View style={styles.buttonContainer}>
                <TouchableOpacity 
                    style={[styles.button, { backgroundColor: 'green' }]} 
                    onPress={() => sendCommand("01 0C")}
                >
                    <Text style={styles.buttonText}>Eng RPM</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={[styles.button, { backgroundColor: 'red' }]} 
                    onPress={() => sendCommand("01 0D")}
                >
                    <Text style={styles.buttonText}>Speed</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={[styles.button, { backgroundColor: 'blue' }]} 
                    onPress={() => sendCommand("ATRV")}
                >
                    <Text style={styles.buttonText}>Battery V</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center' },
    deviceName: { 
        position: 'absolute', top: 10, left: 10, 
        fontSize: 16, fontWeight: 'bold', color: 'green' 
    },
    buttonContainer: { marginTop: 50 },
    button: { padding: 15, borderRadius: 5, marginVertical: 10 },
    buttonText: { color: 'white', fontSize: 18 }
});

export default BluetoothScreen;

