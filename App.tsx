import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';

interface BatteryCell {
  id: number;
  voltage: number | null;
  isCritical: boolean;
}

interface BatteryModule {
  id: number;
  cells: BatteryCell[];
}

interface GlobalVoltageStats {
  maxVoltage: number;
  minVoltage: number;
  voltageDiff: number;
  lastUpdate: string;
}

const VOLTAGE_RANGE = {
  MIN: 2.8,
  MAX: 4.25,
  WARNING_HIGH: 4.2,
  WARNING_LOW: 3.2
};

const App = () => {
  // State
  const [devices, setDevices] = useState<RNBluetoothClassic.BluetoothDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<RNBluetoothClassic.BluetoothDevice | null>(null);
  const [modules, setModules] = useState<BatteryModule[]>([]);
  const [voltageStats, setVoltageStats] = useState<GlobalVoltageStats>({
    maxVoltage: 0,
    minVoltage: 0,
    voltageDiff: 0,
    lastUpdate: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [showClearDtcScreen, setShowClearDtcScreen] = useState(false);

  // Initialize Bluetooth
  useEffect(() => {
    const initBluetooth = async () => {
      setIsLoading(true);
      try {
        const isEnabled = await RNBluetoothClassic.isBluetoothEnabled();
        if (!isEnabled) {
          const enabled = await RNBluetoothClassic.requestBluetoothEnabled();
          if (!enabled) throw new Error('Bluetooth was not enabled');
        }

        const paired = await RNBluetoothClassic.getBondedDevices();
        setDevices(paired);
        
        const connected = await RNBluetoothClassic.getConnectedDevices();
        if (connected.length > 0) await connectDevice(connected[0]);
      } catch (err) {
        setError(`Bluetooth Error: ${(err as Error).message}`);
      } finally {
        setIsLoading(false);
      }
    };

    initBluetooth();

    return () => {
      if (connectedDevice) {
        disconnectDevice().catch(() => {});
      }
    };
  }, []);

  // Refresh device list
  const refreshDevices = async () => {
    try {
      const paired = await RNBluetoothClassic.getBondedDevices();
      setDevices(paired);
    } catch (err) {
      setError(`Failed to refresh devices: ${(err as Error).message}`);
    }
  };

  // Connect to device
  const connectDevice = async (device: RNBluetoothClassic.BluetoothDevice) => {
    setIsLoading(true);
    setConnectionState('connecting');
    setError(null);
    
    try {
      if (connectedDevice) await disconnectDevice();

      await device.connect();
      setConnectedDevice(device);
      await setupBmsMonitoring(device);
      setConnectionState('connected');
    } catch (err) {
      setError(`Connection failed: ${(err as Error).message}`);
      setConnectionState('disconnected');
    } finally {
      setIsLoading(false);
    }
  };

  // Disconnect device
  const disconnectDevice = async () => {
    if (!connectedDevice) return;
    
    try {
      if (connectedDevice.monitorSubscriptions) {
        connectedDevice.monitorSubscriptions.forEach(sub => sub.remove());
      }
      
      await connectedDevice.disconnect();
      setConnectedDevice(null);
      setConnectionState('disconnected');
      setModules([]);
      setVoltageStats({ maxVoltage: 0, minVoltage: 0, voltageDiff: 0, lastUpdate: '' });
      setShowClearDtcScreen(false);
    } catch (err) {
      setError(`Disconnect failed: ${(err as Error).message}`);
    }
  };

  // Configure BMS monitoring
  const setupBmsMonitoring = async (device: RNBluetoothClassic.BluetoothDevice) => {
    try {
      // Configure OBD2 adapter for Tesla BMS
      await device.write('ATZ\r');
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for adapter reset
      await device.write('ATE0\r');
      await device.write('ATH1\r');
      await device.write('ATSP6\r');
      await device.write('ATCAF1\r');
      await device.write('ATFC SH 6F2\r');

      // Set up data listener
      const dataSubscription = device.onDataReceived(({ data }) => {
        try {
          processBmsFrame(data);
        } catch (err) {
          console.error('Data processing error:', err);
          setError(`Data error: ${(err as Error).message}`);
        }
      });

      // Handle disconnection
      const disconnectSubscription = device.onDisconnected(() => {
        setError('Device was disconnected');
        disconnectDevice();
      });

      // Store subscriptions for cleanup
      device.monitorSubscriptions = [dataSubscription, disconnectSubscription];
    } catch (err) {
      setError(`Setup failed: ${(err as Error).message}`);
      await disconnectDevice();
    }
  };

  // Process incoming BMS data frames
  const processBmsFrame = useCallback((rawData: string) => {
    const frame = rawData.trim();
    const now = new Date().toLocaleTimeString();

    // Battery module data (6F2-6FF)
    if (frame.match(/^6F[2-9A-F]/)) {
      const parts = frame.split(' ');
      if (parts.length < 8) return;

      const moduleId = parseInt(parts[0].slice(2), 16);
      const cells: BatteryCell[] = [];

      // Parse cell voltages (6 cells per module)
      for (let i = 1; i <= 6; i += 2) {
        if (parts[i] && parts[i+1]) {
          const hex = parts[i] + parts[i+1];
          const voltage = (parseInt(hex, 16) & 0x7FFF) * 0.001;
          const isValid = voltage >= VOLTAGE_RANGE.MIN && voltage <= VOLTAGE_RANGE.MAX;
          cells.push({
            id: Math.floor(i/2) + 1,
            voltage: isValid ? voltage : null,
            isCritical: !isValid
          });
        } else {
          cells.push({
            id: Math.floor(i/2) + 1,
            voltage: null,
            isCritical: false
          });
        }
      }

      setModules(prev => {
        const updatedModules = [...prev];
        const moduleIndex = updatedModules.findIndex(m => m.id === moduleId);
        
        if (moduleIndex >= 0) {
          updatedModules[moduleIndex] = { id: moduleId, cells };
        } else {
          updatedModules.push({ id: moduleId, cells });
        }

        // Calculate global voltage stats across all cells
        const allVoltages = updatedModules
          .flatMap(m => m.cells.map(c => c.voltage))
          .filter(v => v !== null) as number[];
        
        if (allVoltages.length > 0) {
          const maxVoltage = Math.max(...allVoltages);
          const minVoltage = Math.min(...allVoltages);
          
          setVoltageStats({
            maxVoltage,
            minVoltage,
            voltageDiff: maxVoltage - minVoltage,
            lastUpdate: now
          });
        }

        return updatedModules;
      });
    }
  }, []);

  // Clear BMS_u029 DTC using official CAN command
  const clearBmsDtc = async () => {
    if (!connectedDevice) {
      Alert.alert('Error', 'Not connected to any device');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Verify active connection
      const isConnected = await connectedDevice.isConnected();
      if (!isConnected) throw new Error('Bluetooth disconnected');

      // 2. Configure adapter for Tesla BMS
      await connectedDevice.write('ATZ\r');
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for adapter reset
      await connectedDevice.write('ATE0\r');
      await connectedDevice.write('ATH1\r');
      await connectedDevice.write('ATSP6\r');
      await connectedDevice.write('ATCAF1\r');
      await connectedDevice.write('ATFC SH 6F2\r');

      // 3. Send official UDS Clear DTC command for BMS_u029
      await connectedDevice.write('ATSH6F2\r');
      const clearCommand = '04 31 01 04 0C 00 00 00'; // Official BMS_u029 clear command
      console.log('Sending clear command:', clearCommand);
      await connectedDevice.write(clearCommand + '\r');

      // 4. Set up response listener with timeout
      let responseReceived = false;
      const timeout = setTimeout(() => {
        if (!responseReceived) {
          subscription.remove();
          Alert.alert(
            'Timeout', 
            'No response received. Please check:\n' +
            '1. Adapter is properly connected\n' +
            '2. Vehicle is in Park\n' +
            '3. Ignition is ON',
            [
              {text: 'OK', style: 'cancel'},
              {text: 'Retry', onPress: () => clearBmsDtc()}
            ]
          );
        }
      }, 5000);

      const subscription = connectedDevice.onDataReceived(({ data }) => {
        const cleanedData = data.trim().replace(/\s+/g, ' ');
        console.log('Received response:', cleanedData);
        
        // Check for positive response (6F2 04 71 01 04 0C)
        if (cleanedData.match(/6F2 04 71 01 04 0C/i)) {
          responseReceived = true;
          clearTimeout(timeout);
          subscription.remove();
          Alert.alert('Success', 'BMS_u029 cleared successfully');
        } 
        // Check for negative response (7F 31)
        else if (cleanedData.includes('7F 31')) {
          responseReceived = true;
          clearTimeout(timeout);
          subscription.remove();
          throw new Error(`Vehicle rejected command: ${cleanedData}`);
        }
      });

    } catch (err) {
      setError(`Clear failed: ${(err as Error).message}`);
      Alert.alert(
        'Error', 
        `Failed to clear DTC: ${(err as Error).message}`,
        [
          {text: 'OK', style: 'cancel'},
          {text: 'Retry', onPress: () => clearBmsDtc()}
        ]
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Get color based on voltage value
  const getVoltageColor = (voltage: number | null) => {
    if (voltage === null) return 'gray';
    if (voltage < VOLTAGE_RANGE.MIN || voltage > VOLTAGE_RANGE.MAX) return 'black';
    if (voltage > VOLTAGE_RANGE.WARNING_HIGH || voltage < VOLTAGE_RANGE.WARNING_LOW) return 'orange';
    return 'green';
  };

  // Render battery module
  const renderModule = ({ item }: { item: BatteryModule }) => (
    <View style={styles.moduleCard}>
      <Text style={styles.moduleTitle}>Module {item.id}</Text>
      <View style={styles.cellContainer}>
        {item.cells.map(cell => (
          <View key={`module-${item.id}-cell-${cell.id}`} style={styles.cell}>
            <Text style={styles.cellLabel}>Cell {cell.id}</Text>
            <Text style={[styles.cellValue, { color: getVoltageColor(cell.voltage) }]}>
              {cell.voltage ? cell.voltage.toFixed(3) + 'V' : '--'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );

  // Clear DTC Screen
  const ClearDtcScreen = () => (
    <View style={styles.clearDtcContainer}>
      <Text style={styles.clearDtcTitle}>Clear BMS_u029 DTC</Text>
      
      <Text style={styles.connectionStatus}>
        {connectedDevice ? `Connected to: ${connectedDevice.name}` : 'Not connected'}
      </Text>

      <Text style={styles.clearDtcText}>
        This will attempt to clear the BMS_u029 diagnostic trouble code.
        Ensure:
        {"\n"}• Vehicle is in Park
        {"\n"}• Ignition is on
        {"\n"}• Adapter is properly connected
        {"\n"}• Battery is not critically low
      </Text>
      
      <TouchableOpacity
        style={[styles.clearDtcButton, isLoading && styles.disabledButton]}
        onPress={clearBmsDtc}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.clearDtcButtonText}>Clear BMS_u029</Text>
        )}
      </TouchableOpacity>

      {error && (
        <Text style={styles.errorText}>{error}</Text>
      )}

      <TouchableOpacity
        style={styles.backButton}
        onPress={() => setShowClearDtcScreen(false)}
      >
        <Text style={styles.backButtonText}>Back to Dashboard</Text>
      </TouchableOpacity>
    </View>
  );

  // Dashboard Screen
  const DashboardScreen = () => (
    <View style={styles.container}>
      <Text style={styles.header}>Digital EV Doctor BMS Monitor</Text>
      
      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Connection Status */}
      <View style={styles.statusBar}>
        {isLoading && <ActivityIndicator size="small" color="#0000ff" />}
        {connectionState === 'connected' && (
          <Text style={styles.connectedText}>
            Connected: {connectedDevice?.name}
          </Text>
        )}
        {voltageStats.lastUpdate && (
          <Text style={styles.updateText}>Last update: {voltageStats.lastUpdate}</Text>
        )}
      </View>

      {/* Global Voltage Stats */}
      <View style={styles.statsCard}>
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Max Voltage</Text>
            <Text style={[styles.statValue, { color: getVoltageColor(voltageStats.maxVoltage) }]}>
              {voltageStats.maxVoltage.toFixed(3)}V
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Min Voltage</Text>
            <Text style={[styles.statValue, { color: getVoltageColor(voltageStats.minVoltage) }]}>
              {voltageStats.minVoltage.toFixed(3)}V
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Voltage Difference</Text>
            <Text style={[styles.statValue, { 
              color: voltageStats.voltageDiff > 0.1 ? 'red' : 
                     voltageStats.voltageDiff > 0.05 ? 'orange' : 'green' 
            }]}>
              {voltageStats.voltageDiff.toFixed(3)}V
            </Text>
          </View>
        </View>
      </View>

      {/* Connection Controls */}
      {!connectedDevice ? (
        <>
          <View style={styles.deviceListHeader}>
            <Text style={styles.sectionTitle}>Available Devices</Text>
            <TouchableOpacity onPress={refreshDevices}>
              <Text style={styles.refreshText}>Refresh</Text>
            </TouchableOpacity>
          </View>
          
          <FlatList
            data={devices}
            keyExtractor={item => item.address}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.deviceButton}
                onPress={() => connectDevice(item)}
                disabled={isLoading}
              >
                <Text style={styles.deviceName}>{item.name}</Text>
                <Text style={styles.deviceAddress}>{item.address}</Text>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.deviceList}
          />
        </>
      ) : (
        <>
          <TouchableOpacity
            style={styles.disconnectButton}
            onPress={disconnectDevice}
            disabled={isLoading}
          >
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.clearDtcNavButton}
            onPress={() => setShowClearDtcScreen(true)}
            disabled={isLoading}
          >
            <Text style={styles.clearDtcNavButtonText}>Clear BMS_u029 Alert</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Battery Modules */}
      <Text style={styles.sectionTitle}>Battery Modules ({modules.length})</Text>
      <FlatList
        data={modules}
        renderItem={renderModule}
        keyExtractor={item => `module-${item.id}`}
        contentContainerStyle={styles.modulesList}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {connectedDevice ? 'Waiting for BMS data...' : 'Not connected'}
          </Text>
        }
      />
    </View>
  );

  return showClearDtcScreen ? <ClearDtcScreen /> : <DashboardScreen />;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5'
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#333'
  },
  errorContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffebee',
    padding: 10,
    borderRadius: 5,
    marginBottom: 10
  },
  errorText: {
    color: '#d32f2f',
    flex: 1
  },
  dismissText: {
    color: '#1976d2',
    marginLeft: 10
  },
  statusBar: {
    marginBottom: 16,
    minHeight: 20
  },
  connectedText: {
    color: 'green',
    fontWeight: '500'
  },
  updateText: {
    color: '#666',
    fontSize: 12
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginVertical: 8,
    color: '#333'
  },
  deviceListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  refreshText: {
    color: '#0066cc',
    fontSize: 14
  },
  deviceList: {
    paddingBottom: 16
  },
  deviceButton: {
    padding: 12,
    marginBottom: 8,
    backgroundColor: 'white',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#0066cc'
  },
  deviceName: {
    fontWeight: '500'
  },
  deviceAddress: {
    color: '#666',
    fontSize: 12
  },
  disconnectButton: {
    padding: 12,
    backgroundColor: '#ff4444',
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8
  },
  disconnectText: {
    color: 'white',
    fontWeight: 'bold'
  },
  clearDtcNavButton: {
    padding: 12,
    backgroundColor: '#ff9900',
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16
  },
  clearDtcNavButtonText: {
    color: 'white',
    fontWeight: 'bold'
  },
  statsCard: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap'
  },
  statItem: {
    width: '48%',
    marginBottom: 12
  },
  statLabel: {
    color: '#666',
    fontSize: 14
  },
  statValue: {
    fontSize: 18,
    fontWeight: '500'
  },
  modulesList: {
    paddingBottom: 16
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 16
  },
  moduleCard: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1
  },
  moduleTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#333',
    marginBottom: 8
  },
  cellContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  cell: {
    width: '32%',
    marginBottom: 8
  },
  cellLabel: {
    fontSize: 12,
    color: '#666'
  },
  cellValue: {
    fontSize: 14,
    fontWeight: '500',
    marginVertical: 2
  },
  clearDtcContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: '#f5f5f5'
  },
  clearDtcTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333'
  },
  clearDtcText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: '#666',
    paddingHorizontal: 20,
    lineHeight: 24
  },
  clearDtcButton: {
    backgroundColor: '#ff4444',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20
  },
  clearDtcButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 18
  },
  backButton: {
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0066cc'
  },
  backButtonText: {
    color: '#0066cc',
    fontWeight: 'bold',
    fontSize: 16
  },
  connectionStatus: {
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: 'bold'
  },
  disabledButton: {
    opacity: 0.6
  }
});

export default App;
