import React, { useState, useEffect, useRef } from 'react';
import { View, Text, PermissionsAndroid, TouchableOpacity, FlatList, Animated, Alert, TextInput, StyleSheet, ScrollView } from 'react-native';
import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';

const App: React.FC = () => {
    const [enabled, setEnabled] = useState<boolean>(false);
    const [ifdiscoveredPairedDevices, setDiscoveredPairedDevices] = useState<BluetoothDevice[]>([]);
    const [pairingDevice, setPairingDevice] = useState<string | null>(null);
    const [connectedDevice, setConnectedDevice] = useState<BluetoothDevice | null>(null); // 🔹 Store connected device
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false); // Track authentication

    const [commandData, setCommandData] = useState<string>('');

    const [receivedData, setReceivedData] = useState<string>(''); // 🔹 Store received data

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
        getallPairedDevices();
    }, []);


    const startListeningForData = async () => {
        if (!connectedDevice) return;
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 1000ms before reading

        // try {
        //     connectedDevice.onDataReceived((event) => {
        //         // console.log(`Received: ${event.data}`);
        //         Alert.alert("Data Received", event.data);
        //         setReceivedData((prevData) => prevData + '\n' + event.data); // Append new data
        //     });

        // } catch (error) {
        //     console.error("Error listening for data:", error);
        // }
        // Read ESP32 response
        let response = "";
        let attempts = 0;
        const maxAttempts = 10; // Adjust based on expected response time

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1000ms before reading

            response = (await connectedDevice.read()).toString();
            response = response.trim();
            if (response){
                if (response != "ok" && response != "error" && response != "ESP32: Connection Established" && response.startsWith(commandData)){
                    Alert.alert("Data Received", response);
                    setReceivedData(response);
                } 
                break; // Exit loop if response is received
            }
            attempts++;
        }
    };

    const onStartrequestAccessFineLocationPermission = async () => {
        try {
            const granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                {
                    title: 'Access fine location required for discovery',
                    message: 'Enable location to allow Bluetooth discovery.',
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
        setPairingDevice(String(device.address)); // Set pairing state to show UI feedback
        console.log(String(device.address));
        
        let deviceAlready = await device.isConnected();
        let connected = await device.connect();

        if (connected){
          setConnectedDevice(device); // Store connected device
          console.log(`Connected to ${device.name}`);
          Alert.alert("Access Granted", "You are authenticated.");
          setIsAuthenticated(true);
        }

        setPairingDevice(null); // Reset pairing state after attempt
    };

    // 🔹 Function to send data ("command") to the connected device
    const sendCommandToSerial = async (command: string) => {
        if (!connectedDevice) {
            Alert.alert("No Device Connected", "Please pair and connect a device first.");
            return;
        }

        try {
            const commandWithNewline = command + "\n"; // Append newline
            const success = await connectedDevice.write(commandWithNewline, "utf-8");
            if (success) {
                console.log(`Sent: ${command}`);
                if(command=="command1"){
                    Alert.alert("Command Sent", `Sent "Restart" to ${connectedDevice.name}`);
                } else if(command=="command2"){
                    Alert.alert("Command Sent", `Sent "Reconnect to WiFi" to ${connectedDevice.name}`);
                } else{
                    Alert.alert("Command Sent", `Sent "${command}" to ${connectedDevice.name}`);
                }
                
            } else {
                Alert.alert("Send Failed", "Failed to send data.");
            }
        } catch (error) {
            console.error("Error sending data:", error);
            Alert.alert("Error", "Could not send data. Click on device to reconnecting");
        }
    };

    const getallPairedDevices = async () => {
      const bleEnabled = await RNBluetoothClassic.isBluetoothEnabled();
      if(!bleEnabled){
          const bleEnabledSuccess = await RNBluetoothClassic.requestBluetoothEnabled();
          if (! bleEnabledSuccess) {
              Alert.alert("Permission Denied", "Bluetooth NOT enabled");
              return;
          } 
      }

      try {
        const granted = await onStartrequestAccessFineLocationPermission();
        if (!granted) {
            console.log("Location permission denied");
            return;
        }

        const pairedDevices = await RNBluetoothClassic.getBondedDevices();
        if (pairedDevices) {
          console.log(pairedDevices);
          setDiscoveredPairedDevices(pairedDevices);
        } else {
          console.log("No paired Devices found");
        }
      } catch(err) {
        console.log(err);

      }
    };

    const sendCommandData = async () => {
        if (!connectedDevice) {
            Alert.alert("No Device Connected", "Please pair and connect a device first.");
            return;
        }

        const cmdData = `${commandData}\n`; // Format data

        try {
            const success = await connectedDevice.write(cmdData, "utf-8");
            if (success) {
                console.log(`Sent: ${cmdData}`);
                Alert.alert("Data Sent", "Data sent successfully.");

                startListeningForData();

                //clear the auth fields
                setCommandData('');
            } else {
                Alert.alert("Send Failed", "Failed to send command data.");
            }
        } catch (error) {
            console.error("Error sending data:", error);
            Alert.alert("Error", "Could not send command data.");
        }
    };

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <View style={{ justifyContent:'center', alignItems:'center'}}>
            <Text style={{ padding: 10, borderRadius: 5, marginVertical: 10, fontWeight: 'bold', fontSize: 20, justifyContent:'center', textAlign:'center'}}>Welcome to OBD2 Bluetooth Adapter</Text>
          </View>
            {/* <Text style={{ fontSize: 18, fontWeight: 'bold' }}>Bluetooth is {enabled ? "Enabled" : "Disabled"}</Text> */}

            {/* Start Discovery Button */}
            <TouchableOpacity 
                onPress={getallPairedDevices} 
                style={{ backgroundColor: 'blue', padding: 10, borderRadius: 5, marginVertical: 10 }}
            >
                <Text style={{ color: 'white', fontSize: 16 }}>Reload Paired Devices</Text>
            </TouchableOpacity>

            {/* List of discovered devices */}
            <FlatList
                data={ifdiscoveredPairedDevices}
                keyExtractor={(item) => item.address}
                renderItem={({ item }) => (
                    <TouchableOpacity 
                        onPress={() => connectWithDevice(item)} 
                        style={{
                            padding: 10,
                            marginVertical: 5,
                            borderRadius: 5,
                            backgroundColor: pairingDevice === item.address ? "gray" : "#ddd"
                        }}
                        disabled={pairingDevice === item.address}
                    >
                        <Text style={{ fontSize: 16 }}>{item.name || "Unknown Device"}</Text>
                        <Text style={{ fontSize: 14, color: 'gray' }}>{item.address}</Text>
                        {pairingDevice === item.address && <Text style={{ fontSize: 14, color: 'blue' }}>Connecting...</Text>}
                    </TouchableOpacity>
                )}
            />
            
            {connectedDevice && (
                <View>
                  <Text style={{ padding: 10, borderRadius: 5, marginVertical: 10, fontWeight: 'bold', fontSize: 20}}>Test Commands</Text>
                    <View style={{ flexDirection: 'row', marginTop: 20 }}>
                        <TouchableOpacity 
                            onPress={() => sendCommandToSerial("command1")} 
                            style={{ backgroundColor: 'green', padding: 10, borderRadius: 5, marginHorizontal: 5 }}
                        >
                            <Text style={{ color: 'white', fontSize: 16 }}>Eng RPM</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            onPress={() => sendCommandToSerial("command2")} 
                            style={{ backgroundColor: 'red', padding: 10, borderRadius: 5, marginHorizontal: 5 }}
                        >
                            <Text style={{ color: 'white', fontSize: 16 }}>Speed</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            onPress={() => sendCommandToSerial("command3")} 
                            style={{ backgroundColor: 'red', padding: 10, borderRadius: 5, marginHorizontal: 5 }}
                        >
                            <Text style={{ color: 'white', fontSize: 16 }}>Batt. V</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {isAuthenticated && connectedDevice && (
                <View style={{ marginTop: 20, width: '100%' }}>


                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                        <TextInput
                            style={[styles.input, { flex: 1, marginRight: 5 }]} // Take up half the space with margin
                            placeholder="Type Test Command"
                            placeholderTextColor="#999"
                            value={commandData}
                            onChangeText={setCommandData}
                        />
                    </View>

                    <TouchableOpacity
                        onPress={sendCommandData}
                        style={{ backgroundColor: 'blue', padding: 10, borderRadius: 5, alignItems: 'center' }}
                    >
                        <Text style={{ color: 'white', fontSize: 16 }}>Send Command</Text>
                    </TouchableOpacity>
                </View>
            )}

            {receivedData.length > 0 && (
                <View style={styles.responseContainer}>
                    <Text style={styles.responseHeader}>Received Data:</Text>
                    <ScrollView style={styles.responseBox}>
                        <Text style={styles.responseText}>{receivedData}</Text>
                    </ScrollView>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    header: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
    subHeader: { fontSize: 18, fontWeight: 'bold', marginVertical: 10, textAlign: 'center' },
    button: { backgroundColor: 'blue', padding: 10, borderRadius: 5, alignItems: 'center', marginVertical: 5 },
    buttonText: { color: 'white', fontSize: 16 },
    deviceItem: { padding: 10, marginVertical: 5, borderRadius: 5, backgroundColor: '#ddd' },
    connecting: { backgroundColor: 'gray' },
    connectingText: { fontSize: 14, color: 'blue' },
    deviceText: { fontSize: 16 },
    deviceAddress: { fontSize: 14, color: 'gray' },
    commandButtons: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
    commandButton: { backgroundColor: 'green', padding: 10, borderRadius: 5, marginHorizontal: 5 },
    inputContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 10, fontSize: 16, flex: 1, marginRight: 5 },
    responseContainer: { marginTop: 20, width: '100%' },
    responseHeader: { fontSize: 18, fontWeight: 'bold', marginBottom: 5 },
    responseBox: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 10, maxHeight: 150 },
    responseText: { fontSize: 16, color: 'black' },
});


export default App;