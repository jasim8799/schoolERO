import Vehicle from '../models/Vehicle.js';
import Route from '../models/Route.js';

export const createVehicle = async (req, res) => {
  try {
    const { vehicleNumber, driverName, driverContact, capacity } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    const vehicle = await Vehicle.create({
      vehicleNumber,
      driverName,
      driverContact,
      capacity,
      schoolId,
      createdBy,
    });
    res.status(201).json(vehicle);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getVehicles = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const vehicles = await Vehicle.find({ schoolId });
    res.json(vehicles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createRoute = async (req, res) => {
  try {
    const { name, stops, vehicleId } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    const route = await Route.create({
      name,
      stops,
      vehicleId,
      schoolId,
      createdBy,
    });
    res.status(201).json(route);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getRoutes = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const routes = await Route.find({ schoolId }).populate('vehicleId');
    res.json(routes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
